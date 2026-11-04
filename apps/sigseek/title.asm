; title.asm: the title screen, timing by the machine's clock, the night's
; tally, and dawn. Included by sigseek.asm.
;
; Timing: DigitalRerun has a clock device on port 20: OUT latches a
; record, 15 INs read it, and bytes 11-14 are milliseconds of machine
; time, which follows the machine's speed setting. With it, a tick is
; 100 ms of it whatever the speed; without it (a real Z80, another
; emulator) the busy-wait, calibrated for 4 MHz.
;
; Dawn: the shift begins at 22:00, and a station minute is 3 s, so at
; 06:00 (24 minutes on) the sun comes up over the band and the night is
; tallied: packets, deliveries, letters, fragments, tokens, PIXEL's
; gifts. Any key ends the shift (saved); the next run is the next one.

CLKPORT equ     20
TICKMS  equ     100

; ---------------------------------------------------------------- timing
; clkinit: is there a clock? (it answers 1 to the first IN after a latch)
clkinit: out    (CLKPORT),a
        in      a,(CLKPORT)
        cp      1
        ld      a,0
        jr      nz,ci1
        inc     a
ci1:    ld      (hasclk),a
        or      a
        ret     z
        out     (CLKPORT),a     ; the date: the record's bytes 8 and 9
        ld      b,8
ci2:    in      a,(CLKPORT)
        djnz    ci2
        in      a,(CLKPORT)
        ld      (month),a
        in      a,(CLKPORT)
        ld      (day),a
        call    special
        call    readms
        ld      de,TICKMS
        add     hl,de
        ld      (nextms),hl
        ret

; readms: HL = the low 16 bits of the clock's milliseconds
readms: out     (CLKPORT),a
        ld      b,11
rm1:    in      a,(CLKPORT)
        djnz    rm1
        in      a,(CLKPORT)
        ld      l,a
        in      a,(CLKPORT)
        ld      h,a
        ret

; tickwait: until the next tick. By the clock, 100 ms after the last
; one (or now, if more than a second behind: no rush to catch up); by the
; busy-wait without it.
tickwait: ld    a,(hasclk)
        or      a
        jp      z,delay
tw1:    call    readms
        ld      de,(nextms)
        or      a
        sbc     hl,de           ; now - due: negative, not yet
        bit     7,h
        jr      nz,tw1
        ld      de,1000         ; more than a second late: start afresh
        sbc     hl,de
        jr      nc,tw2
        ld      hl,(nextms)
        ld      de,TICKMS
        add     hl,de
        ld      (nextms),hl
        ret
tw2:    call    readms
        ld      de,TICKMS
        add     hl,de
        ld      (nextms),hl
        ret

; ---------------------------------------------------------------- the date
; special: which night it is, by the date (with the clock only):
;   1 1 January           a new year: the nebula hums
;   2 14 February         Sol & Dee send their love
;   3 11-13 August        the Perseids: meteors, and more of them
;   4 31 October          the ghosts are out: one signal in four
;   5 24-26 December      a still, festive night, snow on the antenna
SP_NEWYR equ    1
SP_VALEN equ    2
SP_PERSE equ    3
SP_GHOST equ    4
SP_FEST equ     5
special: ld     a,(month)
        ld      b,a
        ld      a,(day)
        ld      c,a
        ld      e,0
        ld      a,b
        cp      1
        jr      nz,dq2
        ld      a,c
        cp      1
        jr      nz,dq9
        ld      e,SP_NEWYR
        jr      dq9
dq2:    cp      2
        jr      nz,dq3
        ld      a,c
        cp      14
        jr      nz,dq9
        ld      e,SP_VALEN
        jr      dq9
dq3:    cp      8
        jr      nz,dq4
        ld      a,c
        cp      11
        jr      c,dq9
        cp      14
        jr      nc,dq9
        ld      e,SP_PERSE
        jr      dq9
dq4:    cp      10
        jr      nz,dq5
        ld      a,c
        cp      31
        jr      nz,dq9
        ld      e,SP_GHOST
        jr      dq9
dq5:    cp      12
        jr      nz,dq9
        ld      a,c
        cp      24
        jr      c,dq9
        cp      27
        jr      nc,dq9
        ld      e,SP_FEST
dq9:    ld      a,e
        ld      (spec),a
        ret

; spweather: the first weather of a special night, or 0ffh: none
spweather: ld   a,(spec)
        ld      b,WX_HUM
        cp      SP_NEWYR
        jr      z,sw1
        ld      b,WX_METEOR
        cp      SP_PERSE
        jr      z,sw1
        ld      b,WX_STILL
        cp      SP_FEST
        jr      z,sw1
        ld      b,0ffh
sw1:    ld      a,b
        ret

; spline: the night's word in the log, if it is a special one
spline: ld      a,(spec)
        or      a
        ret     z
        dec     a
        ld      hl,splines
        call    msgof
        jp      logmsg
splines: dw     sl1, sl2, sl3, sl4, sl5
sl1:    db      'A new year over the Lantern Nebula. The whole band hums along.',0
sl2:    db      'The fourteenth of February. Sol & Dee send their love, twice.',0
sl3:    db      'The Perseids are falling tonight. Meteors, all night long.',0
sl4:    db      'The last night of October. The ghosts are out on the band.',0
sl5:    db      'A festive night. Snow on the antenna, tinsel on PIXEL.',0
sptitle: dw     st_1, st_2, st_3, st_4, st_5
st_1:   db      '~ a happy new year ~',0
st_2:   db      '~ with love, from Sol & Dee ~',0
st_3:   db      '~ the Perseids are falling ~',0
st_4:   db      '~ the ghosts are out ~',0
st_5:   db      '~ a festive night ~',0
month:  db      0
day:    db      0
spec:   db      0

; ---------------------------------------------------------------- the title
; title: the station, PIXEL, and the shift; stars twinkle until a key.
; The wait stirs the seed.
title:  call    curoff
        call    cls
        ld      hl,tscr
        ld      b,3
ti_1:   ld      a,(hl)
        or      a
        jr      z,ti_2
        ld      c,1
        call    gotoxy
        call    puts
        inc     hl
        inc     b
        jr      ti_1
ti_2:   ld      b,6             ; the name, bold
        ld      c,30
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_tname
        call    puts
        xor     a
        call    setattr
        ld      b,20            ; which shift
        ld      c,30
        call    gotoxy
        ld      hl,m_tshift
        call    puts
        ld      a,(shift)
        call    decn
        ld      a,(spec)        ; a special night, under it
        or      a
        jr      z,ti_2a
        dec     a
        ld      hl,sptitle
        call    msgof
        ld      b,18
        ld      c,30
        call    gotoxy
        call    puts
ti_2a:  ld      b,22            ; and the key, blinking
        ld      c,30
        call    gotoxy
        ld      a,A_BLINK
        call    setattr
        ld      hl,m_tkey
        call    puts
        xor     a
        call    setattr
ti_3:   call    rnd             ; the wait: twinkle, stir, look for a key
        call    rnd
        and     7
        ld      e,a             ; one of 8 stars
        add     a,a
        ld      hl,stars
        add     a,l
        ld      l,a
        jr      nc,ti_4
        inc     h
ti_4:   ld      b,(hl)
        inc     hl
        ld      c,(hl)
        call    gotoxy
        call    rnd
        and     1
        ld      a,'.'
        jr      z,ti_5
        ld      a,'*'
ti_5:   call    putc
        ld      b,24            ; the cursor out of the way
        ld      c,80
        call    gotoxy
        ld      b,3             ; 0.3 s
ti_6:   push    bc
        call    tickwait
        pop     bc
        djnz    ti_6
        call    key
        or      a
        jr      z,ti_3
        ret

stars:  db      3,9, 4,52, 5,71, 8,14, 9,63, 11,40, 13,5, 15,74

tscr:   db      '        .            *                 .            *         .',0
        db      '                                                         .',0
        db      ' ',0
        db      ' ',0
        db      '                             ~~~~~~~~~~~~~~~~~~~~~~~~~',0
        db      ' ',0
        db      '                 a night shift at Relay Station Kettle-7',0
        db      '                    at the edge of the Lantern Nebula',0
        db      '   .                                                               .',0
        db      ' ',0
        db      '              _||_                                 /\_/\',0
        db      '             /____\       .  o  O  ( 1420.0 )     ( -.- ) zz',0
        db      '       ______|[]|______                            > ^ <',0
        db      '      |  KETTLE-7 RELAY |=================================',0
        db      '  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',0
        db      0
m_tname: db     'S I G N A L   S E E K E R',0
m_tshift: db    '      Shift ',0
m_tkey: db      '  press any key',0

; ---------------------------------------------------------------- the tally
; tallies, for the night: called where things happen
tl_dl:  ld      hl,n_dl
        jr      tl_inc
tl_let: ld      hl,n_let
        jr      tl_inc
tl_frag: ld     hl,n_frag
        jr      tl_inc
tl_gift: ld     hl,n_gift
tl_inc: ld      a,(hl)
        inc     a
        ret     z
        ld      (hl),a
        ret

; ---------------------------------------------------------------- dawn
; dawnq: every tick at the dial: is it 06:00?
dawnq:  ld      a,(dawned)
        or      a
        ret     nz
        ld      a,(hours)
        cp      6
        ret     nz
        ld      a,(mode)
        or      a
        ret     nz
        ld      a,1
        ld      (dawned),a
        ld      a,7
        ld      (mode),a
        xor     a
        ld      (autoon),a
        ld      (dframe),a
        ld      a,1
        ld      (dtick),a
        ld      hl,m_dawn
        call    logmsg
        jp      tally

; dawntk: each tick of the dawn: the sunrise, a frame every 1.5 s
dawntk: ld      hl,dtick
        dec     (hl)
        ret     nz
        ld      (hl),15
        ld      a,(dframe)
        cp      3
        ret     nc
        inc     a
        ld      (dframe),a
        dec     a
        ld      hl,sunfr        ; the frame's four rows
        call    msgof
        ld      b,SPEC_Y
dt_1:   push    bc
        ld      c,SPEC_X
        call    gotoxy
        ld      b,SPEC_W
dt_2:   ld      a,(hl)
        call    putc
        inc     hl
        djnz    dt_2
        pop     bc
        inc     b
        ld      a,b
        cp      SPEC_Y+SPEC_H
        jr      nz,dt_1
        ld      a,(dframe)
        cp      3
        ret     nz
        ld      a,BEL
        jp      putc

; tally: the night, in the packet box
tally:  call    clrbox
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_dhead
        call    puts
        ld      a,(shift)
        call    decn
        ld      hl,m_dhead2
        call    puts
        xor     a
        call    setattr
        ld      b,PK_Y+1
        ld      c,3
        call    gotoxy
        ld      hl,m_d1
        call    puts
        ld      a,(n_pk)
        call    decn
        ld      hl,m_d2
        call    puts
        ld      a,(n_dl)
        call    decn
        ld      hl,m_d3
        call    puts
        ld      a,(n_let)
        call    decn
        ld      hl,m_d4
        call    puts
        ld      a,(n_frag)
        call    decn
        ld      b,PK_Y+2
        ld      c,3
        call    gotoxy
        ld      hl,m_d5
        call    puts
        ld      hl,(tokens)     ; tonight: tokens now - at the start
        ld      de,(tok0)
        or      a
        sbc     hl,de
        call    dec5n
        ld      hl,m_d6
        call    puts
        ld      a,(n_gift)
        call    decn
        ld      b,PK_Y+3
        ld      c,3
        call    gotoxy
        ld      a,(cspot)
        or      a
        ld      hl,m_d7
        jr      z,dy_1
        ld      hl,m_d7b
dy_1:   call    puts
        ld      b,PK_Y+4
        ld      c,3
        call    gotoxy
        ld      a,A_DIM
        call    setattr
        ld      hl,m_d8
        call    puts
        xor     a
        jp      setattr

; dec5n: HL in decimal, no leading zeros (0..65535)
dec5n:  xor     a
        ld      (lead),a
        ld      de,10000
        call    dgsn
        ld      de,1000
        call    dgsn
        ld      de,100
        call    dgsn
        ld      de,10
        call    dgsn
        ld      a,l
        add     a,'0'
        jp      putc
dgsn:   ld      a,'0'-1
dn_1:   inc     a
        or      a
        sbc     hl,de
        jr      nc,dn_1
        add     hl,de
        cp      '0'
        jr      nz,dn_2
        ld      b,a
        ld      a,(lead)
        or      a
        ld      a,b
        ret     z               ; a leading zero: nothing
        jp      putc
dn_2:   ld      b,a
        ld      a,1
        ld      (lead),a
        ld      a,b
        jp      putc

; dkey: dawn's keys: once the sun is up, any key ends the shift
dkey:   ld      a,(dframe)
        cp      3
        jp      c,nokey
        jp      quit

m_dawn: db      'Dawn. The sun comes up over the Lantern Nebula. The shift is done.',0
m_dhead: db     'DAWN, 06:00. The end of shift ',0
m_dhead2: db    '.',0
m_d1:   db      'Packets in: ',0
m_d2:   db      '   delivered: ',0
m_d3:   db      '   letters: ',0
m_d4:   db      '   fragments: ',0
m_d5:   db      'Tokens tonight: +',0
m_d6:   db      '   PIXEL',27h,'s gifts: ',0
m_d7:   db      'PIXEL is asleep on the heater already. Goodnight, operator.',0
m_d7b:  db      'PIXEL comes home to the heater, at last. Goodnight, operator.',0
m_d8:   db      'Any key: end the shift. The station is saved.',0

sunfr:  dw      sunrise, sunrise+4*SPEC_W, sunrise+8*SPEC_W
hasclk: db      0
nextms: dw      0
dawned: db      0
dframe: db      0
dtick:  db      0
tok0:   dw      0
n_pk:   db      0
n_dl:   db      0
n_let:  db      0
n_frag: db      0
n_gift: db      0
; the sunrise: three frames of the band's four rows (made by a script)
sunrise:
        db      '                                                               '
        db      '                                                               '
        db      '                         .     .     .                         '
        db      '________________________..::--==--::.._________________________'
        db      '                                                               '
        db      '                      .        .        .                      '
        db      '                           \   |   /                           '
        db      '__________________________.-=( O )=-.__________________________'
        db      '                         .     *     .                         '
        db      '                           \   |   /                           '
        db      '                          --(  O  )--                          '
        db      '___________________________/   |   \___________________________'
