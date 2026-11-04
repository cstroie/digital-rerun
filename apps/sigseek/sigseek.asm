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
        call    parse
        ld      a,(term)
        cp      0ffh
        call    z,askterm
        call    frame
        call    seed

; ---------------------------------------------------------------- main loop
loop:   call    key
        or      a
        jr      z,nokey
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
        cp      ','
        jr      z,dialdn
        cp      19              ; ^S (WordStar left)
        jr      z,dialdn
        cp      '.'
        jr      z,dialup
        cp      4               ; ^D (WordStar right)
        jr      z,dialup
        jr      nokey
dialdn: ld      hl,(freq)
        dec     hl
        ld      (freq),hl
        call    showfq
        jr      nokey
dialup: ld      hl,(freq)
        inc     hl
        ld      (freq),hl
        call    showfq

nokey:  call    spectr          ; one fresh row of the spectrogram
        call    clock
        ld      hl,(idle)
        inc     hl
        ld      (idle),hl
        ld      de,AWAY
        or      a
        sbc     hl,de
        jr      nz,wait
        ld      a,1
        ld      (away),a
        ld      hl,m_away
        call    logmsg
wait:   call    delay
        jp      loop

quit:   call    cls
        ld      hl,m_bye
        call    puts
        ld      sp,(oldsp)
        ret

back:   ld      hl,m_back
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
; Scrolls three rows down a slot: row 2 gets fresh noise, with a peak
; around the signal's column that is brighter the closer the dial is.
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
        ld      a,(sigcol)
        ld      e,a             ; E = signal column
        ld      d,SPEC_W
        ld      c,0             ; C = column
sp2:    call    rnd
        and     3               ; base noise 0..3
        ld      b,a
        ld      a,c
        sub     e               ; distance from the signal
        jr      nc,sp3
        neg
sp3:    cp      4
        jr      nc,sp4
        ld      h,a
        ld      a,5
        sub     h               ; 5..2 near the signal
        add     a,b
        ld      b,a
sp4:    ld      a,b
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
        inc     c
        dec     d
        jr      nz,sp2
        ret

ramp:   db      ' .:-=+*#%@'

; dial readout and pointer
showfq: ld      b,5
        ld      c,4
        call    gotoxy
        ld      hl,(freq)
        call    dec5
        ld      hl,m_mhz
        jp      puts

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
        ld      hl,m_hello
        jp      logmsg

; log line (row 12): clear it and write HL
logmsg: push    hl
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
parse:  ld      a,0ffh
        ld      (term),a
        ld      hl,TAIL
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
m_bye:  db      'Kettle-7 signing off. Goodnight.',CR,LF,0
m_mhz:  db      ' MHz   [<,  .>]',0

; the frame: 80x24, plain ASCII (DigitalRerun ignores the DEC graphics set)
scr:    db      '+- KETTLE-7 RELAY ----------------------------------- SHIFT 01 -+ +- 22:00 ----+',0
        db      '|                                                               | |   DECK     |',0
        db      '|                                                               | | PWR ######.|',0
        db      '|                                                               | | BUF ...... |',0
        db      '|                                                               | | HUM low    |',0
        db      '+- PACKET ------------------------------------------------------+ +- PIXEL ----+',0
        db      '|                                                               | |  /\_/\     |',0
        db      '|              (no signal captured)                             | | ( -.- ) zz |',0
        db      '|                                                               | |  > ^ <     |',0
        db      '|                                                               | |  heater    |',0
        db      '+- LOG ---------------------------------------------------------+ +------------+',0
        db      '|                                                               |',0
        db      '+---------------------------------------------------------------+',0
        db      ' ',0
        db      ' [<][>] tune   [Q]uit',0,0

; ---------------------------------------------------------------- state
term:   db      0ffh
rseed:  dw      0ace1h
freq:   dw      14204           ; 1420.4 MHz, the hydrogen line
sigcol: db      30
srow:   db      0
tick:   db      0
mins:   db      0
hours:  db      22
idle:   dw      0
away:   db      0
oldsp:  dw      0
        ds      128
stack:

        end     start
