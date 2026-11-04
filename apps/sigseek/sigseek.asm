; SIGSEEK: Signal Seeker, a cozy night shift at Relay Station Kettle-7
;
; M0: the skeleton. Terminal driver (VT100, VT52, ADM-3A), the frame,
; the real-time tick loop with a live spectrogram row, the shift clock,
; away detection, quit.
;
;   A>SIGSEEK          asks for the terminal
;   A>SIGSEEK /100     VT100      /52  VT52      /ADM  ADM-3A
;
; Z80, CP/M 2.2, 4 MHz. Assemble with pasmo:  pasmo sigseek.asm SIGSEEK.COM
;
; Copyright (c) 2026 Costin Stroie, MIT licence.

BDOS    equ     0005h
TAIL    equ     0080h
ESC     equ     27
CR      equ     13
LF      equ     10
BEL     equ     7

T_VT100 equ     0
T_VT52  equ     1
T_ADM   equ     2

; ~10 ticks a second at 4 MHz: 400,000 T-states per tick, less the work
DLY_OUT equ     110             ; outer loops of 256 x DJNZ (13 T) = 3328 T

AWAY    equ     3000            ; ticks without a key (5 min) = away

SPEC_X  equ     2               ; spectrogram: columns 2..64, rows 3..6
SPEC_W  equ     63
SPEC_Y  equ     3
SPEC_H  equ     4
MARK_Y  equ     7               ; the dial's row: < ^ > and the lock
PK_Y    equ     10              ; the packet box, rows 10..14
LOG_Y   equ     17              ; the log, rows 17..20
NLOG    equ     4
LOGW    equ     76              ; characters of a log line kept

        org     100h

start:  ld      (oldsp),sp
        ld      sp,stack
        call    load            ; SIGSEEK.SAV, if there is one
        ld      a,(term)
        ld      (saved),a
        call    parse
        ld      a,(term)
        cp      0ffh
        call    z,askterm
        call    loaddat         ; SIGSEEK.DAT, or a note and back to CP/M
        call    clkinit         ; DigitalRerun's clock, for the ticks
        call    title           ; the title screen, until a key
        ld      hl,(tokens)     ; (for the night's tally)
        ld      (tok0),hl
        call    wxnew           ; tonight's weather
        call    frame
        call    seed
        call    rnd             ; the first signal arrives soon
        call    spn0

; ---------------------------------------------------------------- main loop
loop:   call    key
        or      a
        jp      z,nokey
        ld      hl,0
        ld      (idle),hl
        ld      hl,away
        ld      b,(hl)
        ld      (hl),0
        push    af
        ld      a,b
        or      a
        call    nz,back
        pop     af
        call    upcase
        cp      'Q'
        jp      z,quit
        cp      'P'
        jp      z,pet
        ld      b,a
        ld      a,(mode)
        cp      7
        ld      a,b
        jp      z,dkey
        ld      a,(mode)
        cp      6
        ld      a,b
        jp      z,wkey
        ld      a,(mode)
        cp      5
        ld      a,b
        jp      z,ekey
        ld      a,(mode)
        cp      4
        ld      a,b
        jp      z,rkey
        ld      a,(mode)
        cp      3
        ld      a,b
        jp      z,akey
        ld      a,(mode)
        cp      2
        ld      a,b
        jp      z,skey
        ld      a,(mode)
        or      a
        ld      a,b
        jp      nz,ckey
        cp      'C'
        jp      z,clean
        cp      'S'
        jp      z,shop
        cp      'T'
        jp      z,autot
        cp      'W'
        jp      z,wall
        cp      '?'
        jp      z,help0
        cp      'A'
        jp      z,archive
        ld      de,-1
        cp      ','
        jr      z,tune
        cp      19              ; ^S (WordStar left)
        jr      z,tune
        ld      de,1
        cp      '.'
        jr      z,tune
        cp      4               ; ^D (WordStar right)
        jr      z,tune
        ld      de,-10
        cp      '<'
        jr      z,tune
        cp      24              ; ^X (WordStar down)
        jr      z,tune
        ld      de,10
        cp      '>'
        jr      z,tune
        cp      5               ; ^E (WordStar up)
        jr      z,tune
        jr      nokey
tune:   ld      hl,(freq)
        add     hl,de
        ld      (freq),hl
        call    showfq

nokey:  call    help            ; the keys that work now
        ld      a,(mode)        ; dawn: the sun comes up, the rest waits
        cp      7
        jr      nz,nk1
        call    dawntk
        jr      wait
nk1:    call    dawnq           ; 06:00?
        ld      hl,(ticks)
        inc     hl
        ld      (ticks),hl
        call    spawn           ; now and then, a new signal
        call    age             ; signals drift and fade
        call    stamp           ; where they fall on the band
        call    auto            ; AutoTune, if it is on
        call    wxtick          ; the weather, now and then
        call    scene           ; the Archive's end, if it is playing
        call    spectr          ; one fresh row of the spectrogram
        call    cat             ; PIXEL does as she pleases
        call    lock            ; lock meter and buffer
        call    clock
        ld      hl,(idle)
        inc     hl
        ld      (idle),hl
        ld      de,AWAY
        or      a
        sbc     hl,de
        jr      nz,wait
        ld      hl,m_away
        call    logmsg
        ld      a,1
        ld      (away),a
        xor     a
        ld      (ndia),a
        ld      (missed),a
wait:   ld      b,24            ; park the cursor in the corner, still
        ld      c,80
        call    gotoxy
        call    tickwait
        jp      loop

quit:   call    save
        call    cls
        call    curon
        ld      hl,m_bye
        call    puts
        ld      sp,(oldsp)
        ret

back:   call    showdia
        ld      hl,m_back
        call    logmsg
        ld      a,BEL
        jp      putc

; ---------------------------------------------------------------- receiving
; While the lock holds the buffer fills, and the packet comes in letter
; by letter, in no order: its noise is decided at the start, by the
; signal's strength. If the buffer drains to nothing, it is lost.
rxbegin: ld     a,(havepk)
        ld      b,a
        ld      a,(rcv)
        or      b
        ret     nz
        call    newpk           ; the message and its noise
        ld      a,(pklen)       ; the order the letters come in
        ld      b,a
        ld      hl,perm
        xor     a
rb1:    ld      (hl),a
        inc     hl
        inc     a
        djnz    rb1
        ld      a,(pklen)       ; shuffled: i from len-1 down to 1
        dec     a
rb2:    or      a
        jr      z,rb4
        ld      c,a
        inc     a
        ld      b,a
        call    rnd
rb3:    sub     b               ; j = rnd mod (i + 1)
        jr      nc,rb3
        add     a,b
        ld      e,a             ; swap perm[i], perm[j]
        ld      d,0
        ld      hl,perm
        add     hl,de
        push    hl
        ld      e,c
        ld      hl,perm
        add     hl,de
        pop     de
        ld      a,(de)
        ld      b,(hl)
        ld      (hl),a
        ld      a,b
        ld      (de),a
        ld      a,c
        dec     a
        jr      rb2
rb4:    ld      a,1
        ld      (rcv),a
        ld      a,0ffh
        ld      (rxn),a
        ld      hl,m_rxin
        call    logmsg
        ld      a,(mode)
        or      a
        ret     nz
        jp      drawpk

rxlost: ld      a,(rcv)
        or      a
        ret     z
        xor     a
        ld      (rcv),a
        ld      hl,m_rxlost
        call    logmsg
        ld      a,(mode)
        or      a
        ret     nz
        jp      drawpk

; rxshow: redraw the letters when another has come (only at the dial)
rxshow: ld      a,(rcv)
        or      a
        ret     z
        ld      a,(mode)
        or      a
        ret     nz
        call    rxcount
        ld      hl,rxn
        cp      (hl)
        ret     z
drawrx0: call   rxcount
        ld      (rxn),a
; the letters that have come: perm[0 .. n-1]
        ld      hl,shown
        ld      b,PK_MAX
dx0:    ld      (hl),0
        inc     hl
        djnz    dx0
        ld      a,(rxn)
        or      a
        jr      z,dx2
        ld      b,a
        ld      hl,perm
dx1:    ld      e,(hl)
        ld      d,0
        push    hl
        ld      hl,shown
        add     hl,de
        ld      (hl),1
        pop     hl
        inc     hl
        djnz    dx1
dx2:    ld      b,PK_Y          ; RECEIVING (blinking) at 1420.4 MHz
        ld      c,3
        call    gotoxy
        ld      a,A_BLINK+A_BOLD
        call    setattr
        ld      hl,m_rx
        call    puts
        xor     a
        call    setattr
        ld      hl,m_rxat
        call    puts
        ld      hl,(pkfrq)
        call    dec5
        ld      hl,m_mhz
        call    puts
        ld      a,(pklen)       ; then the hex, and the letters under it
        ld      d,a
        ld      e,0
dx3:    ld      a,e
        add     a,a
        add     a,e
        add     a,3
        ld      c,a
        ld      b,PK_Y+1
        call    gotoxy
        push    de
        ld      d,0
        ld      hl,shown
        add     hl,de
        ld      a,(hl)
        or      a
        jr      nz,dx4
        ld      a,'.'           ; not yet
        call    putc
        call    putc
        ld      b,PK_Y+2
        call    gotoxy
        ld      a,'_'
        call    putc
        jr      dx6
dx4:    ld      hl,pkcur
        add     hl,de
        ld      a,(hl)
        call    hex2
        ld      b,PK_Y+2
        call    gotoxy
        ld      a,(hl)
        cp      ' '
        jr      c,dx5
        cp      127
        jr      c,dx5a
dx5:    ld      a,'?'
dx5a:   call    putc
dx6:    pop     de
        inc     e
        dec     d
        jr      nz,dx3
        ret

; rxcount: A = the letters in: buf * len / 100
rxcount: ld     a,(buf)
        ld      e,a
        ld      d,0
        ld      a,(pklen)
        ld      b,a
        ld      hl,0
rc1:    add     hl,de
        djnz    rc1
        ld      de,100
        ld      a,-1
rc2:    inc     a
        or      a
        sbc     hl,de
        jr      nc,rc2
        ret

; ---------------------------------------------------------------- AutoTune
; T: on or off. Every 0.8 s it steps the dial toward the strongest
; signal it can hear, but it hunts the wrong way a quarter of the time,
; and two steps off it is satisfied: it only now and then goes on to
; the peak. Not very useful, most nights. Cheerful, though.
autot:  ld      a,(autoon)
        xor     1
        ld      (autoon),a
        ld      hl,m_aon
        jr      nz,at1
        ld      hl,m_aoff
at1:    call    logmsg
        call    showau
        jp      nokey

auto:   ld      a,(autoon)
        or      a
        ret     z
        ld      a,(ticks)
        and     7
        ret     nz
        ld      ix,sigs         ; the strongest signal: DE = it - the dial
        ld      b,NSIG
        ld      c,0             ; C = its strength so far
au1:    ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,au2
        ld      a,(ix+S_STR)
        cp      c
        jr      c,au2
        jr      z,au2
        ld      c,a
        ld      l,(ix+S_FRQ)
        ld      h,(ix+S_FRQ+1)
        ld      de,(freq)
        or      a
        sbc     hl,de
        ex      de,hl
au2:    push    de
        ld      de,S_SIZE
        add     ix,de
        pop     de
        djnz    au1
        ld      a,c
        or      a
        ret     z               ; nothing to hear
        ld      a,d
        or      e
        ret     z               ; on it already
        call    rnd
        ld      b,a
        and     3
        jr      nz,au4
        ld      a,b             ; hunting: a step either way
        and     0f0h
        ld      hl,m_ahunt
        call    z,logmsg
        ld      a,b
        and     4
        ld      de,1
        jr      z,au6
        ld      de,-1
        jr      au6
au4:    ld      h,d             ; |DE|
        ld      l,e
        bit     7,h
        jr      z,au5
        xor     a
        sub     l
        ld      l,a
        sbc     a,a
        sub     h
        ld      h,a
au5:    ld      (adist),hl
        ld      a,h
        or      a
        jr      nz,au7
        ld      a,l
        cp      3
        jr      nc,au7
        ld      a,(anear)       ; close enough: it says so, once
        or      a
        jr      nz,au5a
        inc     a
        ld      (anear),a
        ld      hl,m_anear
        call    logmsg
au5a:   ld      a,b             ; and only now and then goes on
        and     1ch
        ret     nz
au7:    xor     a
        ld      (anear),a
        bit     7,d             ; a step toward it: 1, or 10 when far
        ld      hl,1
        jr      z,au8
        ld      hl,-1
au8:    push    hl              ; far (30 steps or more): ten at a time
        ld      hl,(adist)
        ld      a,h
        or      a
        jr      nz,au8a
        ld      a,l
        cp      30
        pop     hl
        jr      c,au10
        jr      au9
au8a:   pop     hl
au9:    add     hl,hl           ; x10
        ld      d,h
        ld      e,l
        add     hl,hl
        add     hl,hl
        add     hl,de
au10:   ex      de,hl
au6:    ld      hl,(freq)
        add     hl,de
        ld      (freq),hl
        jp      showfq

; the deck: AUTO, HISS, PKTS
showau: ld      b,5
        ld      c,76
        call    gotoxy
        ld      a,(autoon)
        or      a
        ld      hl,m_off
        jp      z,puts
        call    revon
        ld      hl,m_on
        call    puts
        jp      revoff
showhs: ld      b,6
        ld      c,76
        call    gotoxy
        ld      a,(purr)
        cp      1
        ld      hl,m_low
        jp      z,puts
        ld      hl,m_mid
        jp      puts
showpk: ld      b,7
        ld      c,76
        call    gotoxy
        xor     a
        ld      (lead),a
        ld      a,(npkt)
        ld      l,a
        ld      h,0
        ld      de,100
        call    dgs
        ld      de,10
        call    dgs
        ld      a,l
        add     a,'0'
        jp      putc

; ---------------------------------------------------------------- the keys line
; help: row 15 lists the keys that work now: they change with the mode
; (the dial, cleaning, the shop, the Archive, routing) and with a packet
; in the buffer or not. Drawn only when that changes.
help:   ld      a,(havepk)
        ld      b,a
        ld      a,(mode)
        add     a,a
        or      b
        ld      hl,lasthp
        cp      (hl)
        ret     z
        ld      (hl),a
        ld      a,(mode)
        or      a
        jr      nz,hp1
        ld      a,b             ; at the dial: with a packet, or without
        ld      hl,k_dial
        or      a
        jr      z,hp2
        ld      hl,k_dialc
        jr      hp2
hp1:    ld      hl,keylns
        call    msgof
hp2:    push    hl
        ld      b,24
        ld      c,1
        call    gotoxy
        call    revon
        pop     hl
        ld      c,79            ; to column 79, not the last: the ADM-3A
        call    padput          ; would wrap, and scroll the screen
        jp      revoff

keylns: dw      k_dial, k_clean, k_shop, k_arch, k_route, k_scene, k_wall, k_dawn
k_dial: db      ' [,.] tune  [<>] coarse  [T]auto  [S]hop  [A]rchive  [W]all  [P]et  [?]help',0
k_dialc: db     ' [C]LEAN THE PACKET  [,.] tune  [<>] coarse  [T]auto  [S]hop  [A]rch  [W]all',0
k_clean: db     ' [1]-[8] flip a bit  [,.] pick a byte  [C] later  [P]et PIXEL  [Q]uit',0
k_shop: db      ' [1]-[8] buy  [S] close the shop  [P]et PIXEL  [Q]uit',0
k_arch: db      ' [,.] turn the page  [A] close the Archive  [P]et PIXEL  [Q]uit',0
k_dawn: db      ' [any key] end the shift, once the sun is up (the station is saved)',0
k_wall: db      ' [,.] the next card  [W] close the wall  [P]et PIXEL  [Q]uit',0
k_scene: db     ' [any key] go on, once it has all been said',0
k_route: db     ' [SPACE] turn a relay  [arrows] move  [C] later  [P]et PIXEL  [Q]uit',0
lasthp: db      0ffh

; ---------------------------------------------------------------- timing
delay:  ld      c,DLY_OUT
dly1:   ld      b,0
dly2:   djnz    dly2
        dec     c
        jr      nz,dly1
        ret

; shift clock: 10 ticks = 1 s; one station minute every 3 s, so the
; night from 22:00 to dawn at 06:00 is 24 minutes
clock:  ld      hl,tick
        inc     (hl)
        ld      a,(hl)
        cp      30
        ret     c
        ld      (hl),0
        ld      hl,mins
        inc     (hl)
        ld      a,(hl)
        cp      60
        jr      c,showtm
        ld      (hl),0
        ld      hl,hours
        inc     (hl)
        ld      a,(hl)
        cp      24
        jr      c,showtm
        ld      (hl),0
showtm: ld      b,1
        ld      c,64
        call    gotoxy
        call    revon
        ld      a,(hours)
        call    dec2
        ld      a,':'
        call    putc
        ld      a,(mins)
        call    dec2
        jp      revoff

; ---------------------------------------------------------------- spectrogram
; The band is SPEC_W steps of 0.1 MHz, the dial at its centre: tuning
; pans it. Each tick rewrites one of the three rows in turn: noise 0..3
; plus the signals' peaks from boost[].
spectr: ld      a,(srow)
        inc     a
        cp      SPEC_H
        jr      c,sp1
        xor     a
sp1:    ld      (srow),a
        add     a,SPEC_Y
        ld      b,a
        ld      c,SPEC_X
        call    gotoxy
        ld      de,boost
        ld      c,SPEC_W
sp2:    call    rnd
        and     3               ; base noise 0..3
        ld      hl,purr
        and     (hl)            ; 1 while PIXEL purrs on the heater
        ld      hl,wmask
        and     (hl)            ; a still night: less static
        ld      hl,wadd
        add     a,(hl)          ; solar wind, the hum: more
        ex      de,hl
        add     a,(hl)
        inc     hl
        ex      de,hl
        cp      10
        jr      c,sp5
        ld      a,9
sp5:    ld      hl,ramp
        add     a,l
        ld      l,a
        jr      nc,sp6
        inc     h
sp6:    ld      a,(hl)
        call    putc
        dec     c
        jr      nz,sp2
        ret

ramp:   db      ' .:-=+*#%@'

; dial readout, the centre mark, and arrows for signals off the band
showfq: ld      b,2
        ld      c,10
        call    gotoxy
        ld      hl,(freq)
        call    dec5
        ld      hl,m_mhz
        call    puts
        ld      b,MARK_Y
        ld      c,SPEC_X+SPEC_W/2
        call    gotoxy
        ld      a,'^'
        jp      putc

; ---------------------------------------------------------------- signals
; A signal: freq (word, tenths of MHz), life (word, ticks; 0 = none),
; strength (3..6), drift (-1, 0, +1 tenth every 32 ticks).
S_FRQ   equ     0
S_LIFE  equ     2
S_STR   equ     4
S_DRF   equ     5
S_BCN   equ     6               ; 1: the last lantern
S_SIZE  equ     7
NSIG    equ     3

; about one new signal every 26 s, while there are fewer than three
spawn:  ld      a,(wx)          ; meteors: one about every 3 s
        cp      WX_METEOR
        jr      nz,spw1
        call    rnd
        and     31
        ret     nz
        jr      spn0
spw1:   call    rnd
        or      a
        ret     nz
spn0:   ld      ix,sigs
        ld      b,NSIG
        ld      de,S_SIZE
spn1:   ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,spn2
        add     ix,de
        djnz    spn1
        ret
spn2:   call    rnd             ; within 6.4 MHz of the dial
        and     127
        sub     64
        ld      l,a
        add     a,a
        sbc     a,a
        ld      h,a
        ld      de,(freq)
        add     hl,de
        ld      (ix+S_FRQ),l
        ld      (ix+S_FRQ+1),h
        call    rnd             ; 30..81 s
        ld      l,a
        ld      h,0
        add     hl,hl
        ld      de,300
        add     hl,de
        ld      (ix+S_LIFE),l
        ld      (ix+S_LIFE+1),h
        call    rnd
        and     3
        add     a,3
        ld      (ix+S_STR),a
        call    rnd
        and     3
        jr      z,spn3          ; 0: -1
        dec     a
        jr      z,spn4          ; 1: +1
        xor     a               ; 2, 3: still
        jr      spn4
spn3:   dec     a
spn4:   ld      (ix+S_DRF),a
        ld      (ix+S_BCN),0
        call    wxsig           ; the weather's say: meteors, a humming night
        ld      hl,m_stir
; quiet: signal news, kept out of the diary while away (only counted)
quiet:  ld      a,(away)
        or      a
        jp      z,logmsg
        ld      a,(missed)
        inc     a
        ret     z
        ld      (missed),a
        ret

; every tick: life runs down; every 32 ticks: drift
age:    ld      ix,sigs
        ld      b,NSIG
ag1:    push    bc
        ld      l,(ix+S_LIFE)
        ld      h,(ix+S_LIFE+1)
        ld      a,h
        or      l
        jr      z,ag3
        dec     hl
        ld      (ix+S_LIFE),l
        ld      (ix+S_LIFE+1),h
        ld      a,h
        or      l
        jr      nz,ag2
        ld      hl,m_fade
        call    quiet
        jr      ag3
ag2:    ld      a,(ticks)
        and     31
        jr      nz,ag3
        ld      a,(ix+S_DRF)
        ld      e,a
        add     a,a
        sbc     a,a
        ld      d,a
        ld      l,(ix+S_FRQ)
        ld      h,(ix+S_FRQ+1)
        add     hl,de
        ld      (ix+S_FRQ),l
        ld      (ix+S_FRQ+1),h
ag3:    ld      de,S_SIZE
        add     ix,de
        pop     bc
        djnz    ag1
        ret

; boost[] = each signal's peak on the band: strength at its column,
; one less for each column away. Also notes signals off either edge.
stamp:  ld      hl,boost
        ld      b,SPEC_W
        xor     a
st0:    ld      (hl),a
        inc     hl
        djnz    st0
        ld      (edges),a
        ld      ix,sigs
        ld      b,NSIG
st1:    push    bc
        ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,st9
        ld      l,(ix+S_FRQ)    ; HL = column = sig - dial + centre
        ld      h,(ix+S_FRQ+1)
        ld      de,(freq)
        or      a
        sbc     hl,de
        ld      de,SPEC_W/2
        add     hl,de
        bit     7,h
        jr      z,st2
        ld      a,(edges)       ; left of the band
        or      1
        ld      (edges),a
        jr      st3
st2:    ld      a,h
        or      a
        jr      nz,st2a
        ld      a,l
        cp      SPEC_W
        jr      c,st3
st2a:   ld      a,(edges)       ; right of the band
        or      2
        ld      (edges),a
st3:    ld      de,-3           ; columns -3..+3 around it
        add     hl,de
        ld      c,-3
st4:    ld      a,h
        or      a
        jr      nz,st6
        ld      a,l
        cp      SPEC_W
        jr      nc,st6
        ld      a,c             ; |offset|
        bit     7,a
        jr      z,st5
        neg
st5:    ld      d,a
        ld      a,(ix+S_STR)
        sub     d
        jr      c,st6
        jr      z,st6
        push    hl
        ld      de,boost
        add     hl,de
        cp      (hl)
        jr      c,st5a
        ld      (hl),a
st5a:   pop     hl
st6:    inc     hl
        inc     c
        ld      a,c
        cp      4
        jr      nz,st4
st9:    ld      de,S_SIZE
        add     ix,de
        pop     bc
        djnz    st1
; the edge arrows on the dial row: '<' at column 2, '>' at column 64
        ld      b,MARK_Y
        ld      c,SPEC_X
        call    gotoxy
        ld      a,(edges)
        and     1
        ld      a,' '
        jr      z,st10
        ld      a,'<'
st10:   call    putc
        ld      c,SPEC_X+SPEC_W-1
        call    gotoxy
        ld      a,(edges)
        and     2
        ld      a,' '
        jr      z,st11
        ld      a,'>'
st11:   jp      putc

; lock: the best signal under the dial. Dead on: full strength, the
; buffer fills; one step off: half. A full buffer is a captured packet.
lock:   xor     a
        ld      (lockv),a
        ld      (lockon),a
        ld      ix,sigs
        ld      b,NSIG
lk1:    ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,lk4
        ld      l,(ix+S_FRQ)
        ld      h,(ix+S_FRQ+1)
        ld      de,(freq)
        or      a
        sbc     hl,de
        ld      a,h
        or      l
        jr      nz,lk2
lkon:   ld      a,1             ; dead on
        ld      (lockon),a
        ld      (lockix),ix
        ld      a,(ix+S_STR)
        jr      lk3
lk2:    inc     hl              ; -1 -> 0, +1 -> 2
        ld      a,h
        or      a
        jr      nz,lk4
        ld      a,l
        cp      3
        jr      nc,lk4
        cp      1
        jr      z,lk4
        ld      a,(upg)         ; the fine tuner: one step off is on
        and     U_TUNER
        jr      nz,lkon
        ld      a,(ix+S_STR)
        srl     a
lk3:    ld      c,a
        ld      a,(lockv)
        cp      c
        jr      nc,lk4
        ld      a,c
        ld      (lockv),a
lk4:    ld      de,S_SIZE
        add     ix,de
        djnz    lk1
; the buffer: fills by the strength when dead on, drains slowly when not
        ld      a,(lockon)
        or      a
        call    nz,rxbegin      ; a packet starts coming in
        ld      a,(lockon)
        or      a
        ld      a,(buf)
        jr      z,lk5
        inc     a               ; one a tick: 10 s to fill
        ld      b,a
        ld      a,(upg)         ; the big buffer: two a tick
        and     U_BUF
        ld      a,b
        jr      z,lkb
        inc     a
lkb:
        cp      100
        jr      nc,captur
        jr      lk6
lk5:    or      a
        jr      z,lk6
        ld      b,a
        ld      a,(ticks)
        and     3
        ld      a,b
        jr      nz,lk6
        dec     a
lk6:    ld      (buf),a
        or      a
        call    z,rxlost        ; drained: what came in is lost
        call    rxshow          ; the letters, as they come
        jp      meters

captur: ld      a,(havepk)      ; one packet at a time
        or      a
        jr      z,cap1
        ld      a,99
        ld      (buf),a
        ld      a,(fullms)
        or      a
        jp      nz,meters
        inc     a
        ld      (fullms),a
        ld      hl,m_full
        call    logmsg
        jp      meters
cap1:   xor     a
        ld      (buf),a
        ld      (rcv),a
        inc     a
        ld      (havepk),a
        ld      ix,(lockix)
        ld      (ix+S_LIFE),a
        ld      (ix+S_LIFE+1),a
        ld      hl,n_pk         ; tonight's
        call    tl_inc
        ld      hl,npkt         ; (stops at 255)
        ld      a,(hl)
        inc     a
        jr      z,cap2
        ld      (hl),a
cap2:
        ld      a,BEL
        call    putc
        call    showpk
        ld      hl,m_got
        ld      a,(pkleft)
        or      a
        jr      nz,cap3
        ld      hl,m_gotcl      ; a strong one: clean already
cap3:   call    logmsg
        call    first
        call    drawpk
        jp      meters

; the lock meter (row 5) and BUF (deck, row 4): bars of '*' and '#'
meters: ld      b,MARK_Y
        ld      c,40
        call    gotoxy
        call    lklook          ; lock / LOCK / LOCK reversed / blinking
        ld      a,(lockv)
        ld      e,'*'
        ld      d,6
        call    bar
        ld      b,4
        ld      c,73
        call    gotoxy
        ld      a,(buf)         ; 0..99 -> 0..6
        ld      b,-1
mt1:    inc     b
        sub     16
        jr      nc,mt1
        ld      a,b
        ld      e,'#'
        ld      d,6
        jr      bar

; lklook: the word LOCK as the lock stands. Nothing: dim lock. Near
; (one step off): LOCK in capitals, bold. Dead on: reversed, and
; blinking when the buffer is nearly full. (VT52: the capitals alone.)
lklook: ld      a,(lockon)
        or      a
        jr      nz,lk_on
        ld      a,(lockv)
        or      a
        ld      a,A_DIM
        ld      hl,m_lock
        jr      z,lkl1
        ld      a,A_BOLD
        ld      hl,m_lock2
lkl1:   push    hl
        call    setattr
        pop     hl
        call    puts
        xor     a
        jp      setattr
lk_on:  ld      a,(buf)
        cp      75
        ld      a,A_REV
        jr      c,lkl2
        ld      a,A_REV+A_BLINK
lkl2:   ld      hl,m_lock3
        jr      lkl1

; bar: A filled of D cells, the filled ones E, the rest '.'
bar:    ld      b,a
br1:    ld      a,d
        or      a
        ret     z
        ld      a,b
        or      a
        ld      a,'.'
        jr      z,br2
        ld      a,e
        dec     b
br2:    call    putc
        dec     d
        jr      br1

; ---------------------------------------------------------------- the frame
; scr holds one 0-terminated string per row, from row 1; a second 0
; ends it. Each row is placed with gotoxy: an 80-column line followed
; by CR LF would wrap on the VT100 and the ADM-3A.
frame:  call    curoff
        call    cls
        ld      b,1             ; the title bar, reversed
        ld      c,1
        call    gotoxy
        call    revon
        ld      hl,m_title
        ld      c,79
        call    padput
        call    revoff
        ld      hl,scr
        ld      b,2
fr1:    ld      a,(hl)
        or      a
        jr      z,fr2
        ld      c,1
        call    gotoxy
        call    puts
        inc     hl
        inc     b
        jr      fr1
fr2:    call    redraw0
        ld      a,(saved)       ; a returning operator
        cp      0ffh
        ld      hl,m_again
        jp      nz,logmsg
        ld      hl,m_hello
        jp      logmsg

; redraw: the whole screen again, as it stands (after the help, say)
redraw: call    curoff
        call    cls
        ld      b,1
        ld      c,1
        call    gotoxy
        call    revon
        ld      hl,m_title
        ld      c,79
        call    padput
        call    revoff
        ld      hl,scr
        ld      b,2
rd1:    ld      a,(hl)
        or      a
        jr      z,rd2
        ld      c,1
        call    gotoxy
        call    puts
        inc     hl
        inc     b
        jr      rd1
rd2:    call    redraw0
        call    drawlog
        call    drawpk
        ld      a,0ffh          ; the keys line, afresh
        ld      (lasthp),a
        ld      a,(cspot)       ; PIXEL, if she is out on a spot
        or      a
        ret     z
        cp      0ffh
        ret     z
        jp      drawsp
; redraw0: what sits in the frame
redraw0: call   showfq
        call    showtm
        call    showtk
        call    shelf
        call    showau
        call    showpk
        call    showwx
        call    showkp
        call    pose
        ld      b,1             ; the shift number
        ld      c,58
        call    gotoxy
        call    revon
        ld      a,(shift)
        call    dec2
        jp      revoff

; help0: ? at the dial: how the night works, a page; time stands still
; while it is read. Any key, and the station is back as it was.
help0:  call    cls
        ld      hl,helptx
        ld      b,2
hl1:    ld      a,(hl)
        or      a
        jr      z,hl2
        ld      c,1
        call    gotoxy
        call    puts
        inc     hl
        inc     b
        jr      hl1
hl2:    ld      b,24
        ld      c,1
        call    gotoxy
        call    revon
        ld      hl,m_hkey
        ld      c,79
        call    padput
        call    revoff
        call    getkey
        call    redraw
        jp      nokey
m_hkey: db      ' [any key] back to the station',0
helptx: db      ' SIGNAL SEEKER  -  how the night works',0
        db      ' ',0
        db      ' THE BAND  Signals are peaks. Tune with , . (0.1 MHz) or < > (1 MHz), or the',0
        db      '           arrows. A < or > at an edge: a signal off the band, that way.',0
        db      ' LOCK      On a peak LOCK lights up, the buffer fills, and the packet comes',0
        db      '           in letter by letter. Let it slip and it scatters. T: AutoTune.',0
        db      ' CLEAN     C. A noisy byte has one wrong bit: make its ones match (the ones',0
        db      '           it has / should have). 1-8 flip a bit, , . pick. Mistakes are free.',0
        db      ' ROUTE     A caller',27h,'s packet: turn the relays (SPACE) until ANT reaches them.',0
        db      ' DELIVER   Tokens. Letters move the callers',27h,' stories on; fragments go to the',0
        db      '           Archive (A); a finished story sends a postcard (W: the wall).',0
        db      ' SHOP      S. Things that help, and things for the shelf. Nothing gets harder.',0
        db      ' PIXEL     P pets her, or calls her. She has her own plans. Asleep on the',0
        db      '           heater she purrs and the static drops; at the antenna, her ears',0
        db      '           point at signals you have not found yet.',0
        db      ' WEATHER   In the title bar. Some nights are noisy, some still, some hum.',0
        db      ' THE NIGHT 22:00 to dawn at 06:00, about 24 minutes. Q ends it early (saved).',0
        db      ' AWAY      Leave for five minutes and PIXEL keeps a diary for you.',0
        db      ' ',0
        db      ' Some say the last lantern can still be heard at 1420.0 MHz.',0
        db      0

; logmsg: a line for the log (HL). The log shows the last four: the
; newest at the bottom, reversed, with a > before it; the one above
; plain; the two oldest dim.
logmsg: ld      a,(hl)          ; a count first: a table of variants
        cp      16
        call    c,vary
        call    diary
        push    hl
        ld      hl,logl+LOGW+1  ; the lines up one
        ld      de,logl
        ld      bc,NLOG*LOGW+NLOG-LOGW-1
        ldir
        pop     hl              ; DE: the last line. The new one in it
        ld      b,LOGW
lg1:    ld      a,(hl)
        or      a
        jr      z,lg2
        ld      (de),a
        inc     hl
        inc     de
        djnz    lg1
lg2:    xor     a
        ld      (de),a
; drawlog: the four lines
drawlog: ld     hl,logl
        ld      b,LOG_Y
lg3:    push    bc
        push    hl
        ld      c,2
        call    gotoxy
        ld      a,b             ; how it looks, by its row
        sub     LOG_Y
        ld      c,a
        ld      a,A_DIM
        cp      a               ; (Z)
        ld      a,c
        cp      2
        ld      a,A_DIM
        jr      c,lg4
        ld      a,c
        cp      NLOG-1
        ld      a,0
        jr      nz,lg4
        ld      a,A_REV
lg4:    push    af
        call    setattr
        pop     af
        ld      hl,m_lgold
        or      a
        jr      z,lg5
        cp      A_REV
        jr      nz,lg5
        ld      hl,m_lgnew
lg5:    call    puts
        pop     hl
        push    hl
        ld      c,LOGW
        call    padput
        xor     a
        call    setattr
        pop     hl
        ld      de,LOGW+1
        add     hl,de
        pop     bc
        inc     b
        ld      a,b
        cp      LOG_Y+NLOG
        jr      nz,lg3
        ret

; vary: HL = a table (a count, then that many pointers): one of them
vary:   ld      b,a
        inc     hl
        push    hl
        call    rnd
vr1:    sub     b               ; rnd mod count
        jr      nc,vr1
        add     a,b
        pop     hl
        jp      msgof

; padput: HL (0-terminated) then blanks, C characters in all
padput: ld      a,(hl)
        or      a
        jr      z,pp2
        call    putc
        inc     hl
        dec     c
        jr      nz,padput
        ret
pp2:    ld      a,' '
pp3:    call    putc
        dec     c
        jr      nz,pp3
        ret

; ---------------------------------------------------------------- terminal
; gotoxy: B = row (1-based), C = column (1-based)
gotoxy: push    bc
        push    hl
        ld      a,(term)
        cp      T_VT100
        jr      nz,gx52
        ld      a,ESC
        call    putc
        ld      a,'['
        call    putc
        ld      a,b
        call    decn
        ld      a,';'
        call    putc
        ld      a,c
        call    decn
        ld      a,'H'
        call    putc
        jr      gxend
gx52:   ld      a,ESC
        call    putc
        ld      a,(term)
        cp      T_VT52
        ld      a,'Y'
        jr      z,gx1
        ld      a,'='
gx1:    call    putc
        ld      a,b
        add     a,31
        call    putc
        ld      a,c
        add     a,31
        call    putc
gxend:  pop     hl
        pop     bc
        ret

cls:    ld      a,(term)
        ld      hl,c_vt100
        cp      T_VT100
        jp      z,puts
        ld      hl,c_vt52
        cp      T_VT52
        jp      z,puts
        ld      a,26            ; ^Z
        jp      putc

; setattr: A = the look from here on, of A_BOLD A_DIM A_BLINK A_REV, 0
; plain. VT100: ESC [ 0 ; 1 ; 2 ; 5 ; 7 m. ADM: ESC G n (2 blink, 4
; reverse) and ESC ) ( (half intensity on, off); no bold. VT52: none.
A_BOLD  equ     1
A_DIM   equ     2
A_BLINK equ     4
A_REV   equ     8
setattr: ld     c,a
        ld      a,(term)
        cp      T_VT52
        ret     z
        cp      T_ADM
        jr      z,sa_adm
        ld      a,ESC
        call    putc
        ld      a,'['
        call    putc
        ld      a,'0'
        call    putc
        ld      b,'1'
        ld      a,c
        and     A_BOLD
        call    nz,sa_n
        ld      b,'2'
        ld      a,c
        and     A_DIM
        call    nz,sa_n
        ld      b,'5'
        ld      a,c
        and     A_BLINK
        call    nz,sa_n
        ld      b,'7'
        ld      a,c
        and     A_REV
        call    nz,sa_n
        ld      a,'m'
        jp      putc
sa_n:   ld      a,';'
        call    putc
        ld      a,b
        jp      putc
sa_adm: ld      a,ESC
        call    putc
        ld      a,'G'
        call    putc
        ld      b,'0'
        ld      a,c
        and     A_BLINK
        jr      z,sa1
        inc     b
        inc     b
sa1:    ld      a,c
        and     A_REV
        jr      z,sa2
        ld      a,b
        add     a,4
        ld      b,a
sa2:    ld      a,b
        call    putc
        ld      a,ESC
        call    putc
        ld      a,c
        and     A_DIM
        ld      a,'('
        jr      z,sa3
        ld      a,')'
sa3:    jp      putc

; reverse video on and off
revon:  ld      a,A_REV
        jp      setattr
revoff: xor     a
        jp      setattr

; the cursor, hidden and shown: VT100 ESC[?25l/h (a VT220 code most VT100s
; answer), ADM ESC C 4 / ESC B 4 (the later ADM extension); VT52 has none,
; and there the parked cursor will do
curoff: ld      hl,h_vt100
        ld      de,h_adm
        jr      cur1
curon:  ld      hl,s_vt100
        ld      de,s_adm
cur1:   ld      a,(term)
        cp      T_VT100
        jp      z,puts
        cp      T_ADM
        ret     nz
        ex      de,hl
        jp      puts
h_vt100: db     ESC,'[?25l',0
s_vt100: db     ESC,'[?25h',0
h_adm:  db      ESC,'C4',0
s_adm:  db      ESC,'B4',0

c_vt100: db     ESC,'[H',ESC,'[2J',0
c_vt52: db      ESC,'H',ESC,'J',0

; ---------------------------------------------------------------- console
putc:   push    af
        push    bc
        push    de
        push    hl
        ld      e,a
        ld      c,6
        call    BDOS
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret

; key: A = key or 0, no wait. VT100/VT52 arrows (ESC [ C, ESC C) map
; to WordStar ^E ^X ^S ^D.
key:    call    raw
        cp      ESC
        ret     nz
        call    raw
        cp      '['
        jr      nz,key1
        call    raw
key1:   cp      'A'
        ld      b,5
        jr      z,key2
        cp      'B'
        ld      b,24
        jr      z,key2
        cp      'C'
        ld      b,4
        jr      z,key2
        cp      'D'
        ld      b,19
        jr      z,key2
        ld      b,ESC
key2:   ld      a,b
        ret
raw:    push    bc
        push    de
        push    hl
        ld      e,0ffh
        ld      c,6
        call    BDOS
        pop     hl
        pop     de
        pop     bc
        ret

; wait for a key
getkey: call    key
        or      a
        jr      z,getkey
        ret

puts:   ld      a,(hl)
        or      a
        ret     z
        call    putc
        inc     hl
        jr      puts

upcase: cp      'a'
        ret     c
        cp      'z'+1
        ret     nc
        sub     32
        ret

; A in decimal, no padding (for VT100 coordinates)
decn:   cp      10
        jr      c,dn1
        ld      b,'0'-1
dn0:    inc     b
        sub     10
        jr      nc,dn0
        add     a,10
        push    af
        ld      a,b
        call    putc
        pop     af
dn1:    add     a,'0'
        jp      putc

; A as two digits
dec2:   ld      b,'0'-1
d20:    inc     b
        sub     10
        jr      nc,d20
        add     a,10+'0'
        push    af
        ld      a,b
        call    putc
        pop     af
        jp      putc

; HL as NNNN.N (tenths of MHz)
dec5:   ld      de,10000
        call    dg
        ld      de,1000
        call    dg
        ld      de,100
        call    dg
        ld      de,10
        call    dg
        ld      a,'.'
        call    putc
        ld      a,l
        add     a,'0'
        jp      putc
dg:     ld      a,'0'-1
dg1:    inc     a
        or      a
        sbc     hl,de
        jr      nc,dg1
        add     hl,de
        jp      putc

; ---------------------------------------------------------------- random
; xorshift16 (7,9,8)
rnd:    push    hl
        ld      hl,(rseed)
        ld      a,h
        rra
        ld      a,l
        rra
        xor     h
        ld      h,a
        ld      a,l
        rra
        ld      a,h
        rra
        xor     l
        ld      l,a
        xor     h
        ld      h,a
        ld      (rseed),hl
        pop     hl
        ret

; the seed: R register mixed with the time the player took at the menu
seed:   ld      a,r
        ld      hl,(rseed)
        xor     l
        ld      l,a
        or      h
        jr      nz,sd1
        inc     l
sd1:    ld      (rseed),hl
        ret

; ---------------------------------------------------------------- terminal choice
; command tail: /100 /52 /ADM
parse:  ld      hl,TAIL
        ld      b,(hl)
        inc     hl
pa1:    ld      a,b
        or      a
        ret     z
        ld      a,(hl)
        inc     hl
        dec     b
        cp      '/'
        jr      nz,pa1
        ld      a,(hl)
        cp      '1'
        ld      c,T_VT100
        jr      z,pa2
        cp      '5'
        ld      c,T_VT52
        jr      z,pa2
        cp      'A'
        ld      c,T_ADM
        jr      z,pa2
        ret
pa2:    ld      a,c
        ld      (term),a
        ret

askterm: ld     hl,m_ask
        call    puts
ak1:    ld      hl,(rseed)      ; the wait stirs the seed
        inc     hl
        ld      (rseed),hl
        call    raw
        sub     '1'
        jr      c,ak1
        cp      3
        jr      nc,ak1
        ld      (term),a
        ret

; ---------------------------------------------------------------- texts
m_ask:  db      CR,LF,'SIGNAL SEEKER',CR,LF,CR,LF
        db      'Your terminal?  1 VT100   2 VT52   3 ADM-3A  ',0
m_hello: db      4
        dw      m_hello_0, m_hello_1, m_hello_2, m_hello_3
m_hello_0: db      'Shift begins. Kettle warm. PIXEL asleep on the heater.',0
m_hello_1: db      'Night shift. The relay hums, the kettle ticks, PIXEL snores.',0
m_hello_2: db      'You settle in. The band is wide awake, even if PIXEL is not.',0
m_hello_3: db      '22:00. Headphones on, tea poured. PIXEL claims the heater.',0
m_away: db      3
        dw      m_away_0, m_away_1, m_away_2
m_away_0: db      'The operator has stepped away. The station hums on.',0
m_away_1: db      'You are away from the dial. The night carries on without you.',0
m_away_2: db      'Away. The kettle cools, the band murmurs, PIXEL is in charge.',0
m_back: db      4
        dw      m_back_0, m_back_1, m_back_2, m_back_3
m_back_0: db      'Welcome back. PIXEL pretends she did not miss you.',0
m_back_1: db      'Welcome back. The chair was kept warm (by a cat).',0
m_back_2: db      'You are back. PIXEL looks up as if you never left.',0
m_back_3: db      'Back at the dial. The band did not wait, but it is glad.',0
m_again: db      4
        dw      m_again_0, m_again_1, m_again_2, m_again_3
m_again_0: db      'Another shift. PIXEL is already here, of course.',0
m_again_1: db      'Another shift. Your chair is warm: PIXEL was keeping it.',0
m_again_2: db      'Another shift. The relay remembers your hand on the dial.',0
m_again_3: db      'Another shift. PIXEL yawns hello, which is a lot, for her.',0
m_bye:  db      'Kettle-7 signing off. Goodnight.',CR,LF,0
m_mhz:  db      ' MHz',0
m_title: db     ' KETTLE-7 RELAY  :                                 SHIFT              TOK',0
m_lgold: db     '  ',0
m_lgnew: db     '> ',0
m_stir: db      5
        dw      m_stir_0, m_stir_1, m_stir_2, m_stir_3, m_stir_4
m_stir_0: db      'Something stirs on the band.',0
m_stir_1: db      'A new peak lifts out of the hiss.',0
m_stir_2: db      'Someone, somewhere, is on the air.',0
m_stir_3: db      'The band brightens a little, over there.',0
m_stir_4: db      'A signal drifts in from the dark.',0
m_fade: db      4
        dw      m_fade_0, m_fade_1, m_fade_2, m_fade_3
m_fade_0: db      'A signal faded into the hiss. It will be back some night.',0
m_fade_1: db      'A peak sinks back into the static. Next time, maybe.',0
m_fade_2: db      'Gone again: whoever it was has moved on.',0
m_fade_3: db      'A signal let go of the band. The hiss closes over it.',0
m_got:  db      4
        dw      m_got_0, m_got_1, m_got_2, m_got_3
m_got_0: db      'Packet captured! Press C to clean it.',0
m_got_1: db      'Got it! The packet is in the buffer: C to clean it.',0
m_got_2: db      'In the buffer, safe and a little scrambled. Press C.',0
m_got_3: db      'Captured. It needs a tidy before it goes on: C.',0
m_gotcl: db      3
        dw      m_gotcl_0, m_gotcl_1, m_gotcl_2
m_gotcl_0: db      'Packet captured, and clean already! Press C to send it on.',0
m_gotcl_1: db      'A strong one: it came in clean. Press C to send it on.',0
m_gotcl_2: db      'Not a bit out of place. Press C and it is on its way.',0
m_rxin: db      4
        dw      m_rxin_0, m_rxin_1, m_rxin_2, m_rxin_3
m_rxin_0: db      'Locked on. A packet is coming in...',0
m_rxin_1: db      'LOCK. Letters start to land in the buffer...',0
m_rxin_2: db      'Holding the peak. Something is coming through...',0
m_rxin_3: db      'Locked. Keep the dial still, it is arriving...',0
m_rxlost: db      3
        dw      m_rxlost_0, m_rxlost_1, m_rxlost_2
m_rxlost_0: db      'The signal slipped. The letters scatter back into the hiss.',0
m_rxlost_1: db      'Lost it. The half-a-message drifts away again.',0
m_rxlost_2: db      'The lock let go; the letters fall back into the static.',0
m_rx:   db      'RECEIVING',0
m_rxat: db      '  at ',0
m_aon:  db      'AutoTune on. It hums with enormous confidence.',0
m_aoff: db      'AutoTune off. It sulks, quietly.',0
m_ahunt: db     'AutoTune is quite sure it is this way. It is not.',0
m_anear: db     'AutoTune: close enough! (It is not quite.)',0
m_on:   db      ' ON',0
m_off:  db      'off',0
m_low:  db      'low',0
m_mid:  db      'mid',0
m_full: db      'The buffer is full. Clean the packet first (C).',0
m_lock: db      'lock ',0
m_lock2: db     'LOCK ',0
m_lock3: db     'LOCK ',0

scr:    db      '+- BAND             --------------------------------------------+ +- DECK -----+',0
        db      '|                                                               | | PWR ######.|',0
        db      '|                                                               | | BUF ...... |',0
        db      '|                                                               | | AUTO   off |',0
        db      '|                                                               | | HISS   low |',0
        db      '|                                                               | | PKTS     0 |',0
        db      '+---------------------------------------------------------------+ +------------+',0
        db      '+- PACKET ------------------------------------------------------+ +- PIXEL ----+',0
        db      '|                                                               | |   /\_/\    |',0
        db      '|                                                               | |  ( -.- ) zz|',0
        db      '|              (no signal yet)                                  | |   > ^ <    |',0
        db      '|                                                               | |  heater    |',0
        db      '|                                                               | |            |',0
        db      '+---------------------------------------------------------------+ +------------+',0
        db      '+- LOG ------------------------------------------------------------------------+',0
        db      '|                                                                              |',0
        db      '|                                                                              |',0
        db      '|                                                                              |',0
        db      '|                                                                              |',0
        db      '+------------------------------------------------------------------------------+',0
        db      ' ',0
        db      '                                                 keyboard [::::::::::]',0,0

; ---------------------------------------------------------------- state
term:   db      0ffh
rseed:  dw      0ace1h
freq:   dw      14204           ; 1420.4 MHz, the hydrogen line
ticks:  dw      0
rcv:    db      0               ; 1: a packet coming in
rxn:    db      0
perm:   ds      20              ; (PK_MAX)
shown:  ds      20
autoon: db      0
anear:  db      0
adist:  dw      0
logl:   ds      NLOG*(LOGW+1)
purr:   db      1
fullms: db      0
missed: db      0
sigs:   ds      NSIG*S_SIZE
boost:  ds      SPEC_W
edges:  db      0
lockv:  db      0
lockon: db      0
lockix: dw      sigs
buf:    db      0
npkt:   db      0
srow:   db      0
tick:   db      0
mins:   db      0
hours:  db      22
idle:   dw      0
away:   db      0
oldsp:  dw      0
        ds      128
stack:

        include cat.asm
        include clean.asm
        include shop.asm
        include story.asm
        include route.asm
        include weather.asm
        include cards.asm
        include title.asm

; SIGSEEK.DAT is read here, after everything else
datbuf:

        end     start
