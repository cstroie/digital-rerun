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

SPEC_X  equ     2               ; spectrogram: columns 2..64, rows 2..4
SPEC_W  equ     63
SPEC_Y  equ     2

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

nokey:  ld      hl,(ticks)
        inc     hl
        ld      (ticks),hl
        call    spawn           ; now and then, a new signal
        call    age             ; signals drift and fade
        call    stamp           ; where they fall on the band
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
wait:   call    delay
        jp      loop

quit:   call    save
        call    cls
        ld      hl,m_bye
        call    puts
        ld      sp,(oldsp)
        ret

back:   call    showdia
        ld      hl,m_back
        call    logmsg
        ld      a,BEL
        jp      putc

; ---------------------------------------------------------------- timing
delay:  ld      c,DLY_OUT
dly1:   ld      b,0
dly2:   djnz    dly2
        dec     c
        jr      nz,dly1
        ret

; shift clock: 10 ticks = 1 s; one station minute every 6 s
clock:  ld      hl,tick
        inc     (hl)
        ld      a,(hl)
        cp      60
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
        ld      c,70
        call    gotoxy
        ld      a,(hours)
        call    dec2
        ld      a,':'
        call    putc
        ld      a,(mins)
        jp      dec2

; ---------------------------------------------------------------- spectrogram
; The band is SPEC_W steps of 0.1 MHz, the dial at its centre: tuning
; pans it. Each tick rewrites one of the three rows in turn: noise 0..3
; plus the signals' peaks from boost[].
spectr: ld      a,(srow)
        inc     a
        cp      3
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
showfq: ld      b,5
        ld      c,4
        call    gotoxy
        ld      hl,(freq)
        call    dec5
        ld      hl,m_mhz
        call    puts
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
S_SIZE  equ     6
NSIG    equ     3

; about one new signal every 26 s, while there are fewer than three
spawn:  call    rnd
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
; the edge arrows on row 5: '<' at column 2, '>' at column 64
        ld      b,5
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
        ld      ix,(lockix)
        ld      (ix+S_LIFE),a
        ld      (ix+S_LIFE+1),a
        ld      hl,npkt         ; (stops at 255)
        ld      a,(hl)
        inc     a
        jr      z,cap2
        ld      (hl),a
cap2:
        ld      a,BEL
        call    putc
        ld      hl,m_got
        call    logmsg
        call    newpk           ; the packet: a message, some noise
        call    drawpk
        jp      meters

; the lock meter (row 5) and BUF (deck, row 4): bars of '*' and '#'
meters: ld      b,5
        ld      c,42
        call    gotoxy
        ld      hl,m_lock
        call    puts
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
frame:  call    cls
        ld      hl,scr
        ld      b,1
fr1:    ld      a,(hl)
        or      a
        jr      z,fr2
        ld      c,1
        call    gotoxy
        call    puts
        inc     hl
        inc     b
        jr      fr1
fr2:    call    showfq
        call    showtm
        call    showtk
        call    shelf
        ld      b,1             ; the shift number
        ld      c,61
        call    gotoxy
        ld      a,(shift)
        call    dec2
        ld      a,(saved)       ; a returning operator
        cp      0ffh
        ld      hl,m_again
        jp      nz,logmsg
        ld      hl,m_hello
        jp      logmsg

; log line (row 12): clear it and write HL
logmsg: call    diary
        push    hl
        ld      b,12
        ld      c,2
        call    gotoxy
        ld      b,SPEC_W
lm1:    ld      a,' '
        call    putc
        djnz    lm1
        ld      b,12
        ld      c,2
        call    gotoxy
        call    revon
        pop     hl
        call    puts
        jp      revoff

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

; reverse video: VT100 ESC[7m; ADM ESC G4 (the extension DigitalRerun
; knows); VT52 has none
revon:  ld      a,(term)
        ld      hl,r_vt100
        cp      T_VT100
        jp      z,puts
        ld      hl,r_adm
        cp      T_ADM
        jp      z,puts
        ret
revoff: ld      a,(term)
        ld      hl,o_vt100
        cp      T_VT100
        jp      z,puts
        ld      hl,o_adm
        cp      T_ADM
        jp      z,puts
        ret

c_vt100: db     ESC,'[H',ESC,'[2J',0
c_vt52: db      ESC,'H',ESC,'J',0
r_vt100: db     ESC,'[7m',0
o_vt100: db     ESC,'[0m',0
r_adm:  db      ESC,'G4',0
o_adm:  db      ESC,'G0',0

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
m_hello: db     'Shift begins. Kettle warm. PIXEL asleep on the heater.',0
m_away: db      'The operator has stepped away. The station hums on.',0
m_back: db      'Welcome back. PIXEL pretends she did not miss you.',0
m_again: db     'Another shift. PIXEL is already here, of course.',0
m_bye:  db      'Kettle-7 signing off. Goodnight.',CR,LF,0
m_mhz:  db      ' MHz',0
m_stir: db      'Something stirs on the band.',0
m_fade: db      'A signal faded into the hiss. It will be back some night.',0
m_got:  db      'Packet captured! Press C to clean it.',0
m_full: db      'The buffer is full. Clean the packet first (C).',0
m_lock: db      'lock ',0

; the frame: 80x24, plain ASCII (DigitalRerun ignores the DEC graphics set)
scr:    db      '+- KETTLE-7 RELAY ----------------------------------- SHIFT 01 -+ +- 22:00 ----+',0
        db      '|                                                               | |   DECK     |',0
        db      '|                                                               | | PWR ######.|',0
        db      '|                                                               | | BUF ...... |',0
        db      '|                                                               | | TOK      0 |',0
        db      '+- PACKET ------------------------------------------------------+ +- PIXEL ----+',0
        db      '|                                                               | |  /\_/\     |',0
        db      '|              (no signal captured)                             | | ( -.- ) zz |',0
        db      '|                                                               | |  > ^ <     |',0
        db      '|                                                               | |  heater    |',0
        db      '+- LOG ---------------------------------------------------------+ +------------+',0
        db      '|                                                               |',0
        db      '+---------------------------------------------------------------+',0
        db      ' ',0
        db      ' [,][.] tune  [<][>] coarse  [C]lean [S]hop [A]rchive [P]IXEL [Q]uit',0,0

; ---------------------------------------------------------------- state
term:   db      0ffh
rseed:  dw      0ace1h
freq:   dw      14204           ; 1420.4 MHz, the hydrogen line
ticks:  dw      0
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

; SIGSEEK.DAT is read here, after everything else
datbuf:

        end     start
