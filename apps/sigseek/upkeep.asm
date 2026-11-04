; upkeep.asm: the station's small troubles. Included by sigseek.asm.
;
; Every four to eight minutes the power may sag: PWR drops in the deck and
; the buffer fills at half speed. F at the dial opens the power register:
; a byte to set to the value the manual says, with 1-8 flipping its bits
; as in cleaning. Set right: full power, and 3 tokens. Never urgent: a
; sagging station still works, only slower.

; uptick: every tick: count down to the next trouble
uptick: ld      a,(pwrlow)
        or      a
        ret     nz
        ld      hl,(uptime)
        dec     hl
        ld      (uptime),hl
        ld      a,h
        or      l
        ret     nz
        call    upnext
        ld      a,1             ; the power sags: a byte knocked out of true
        ld      (pwrlow),a
        call    rnd
        ld      (pwant),a
        ld      (preg),a
        call    upflip          ; one or two bits off
        call    rnd
        and     1
        call    z,upflip
        ld      a,(preg)        ; (if both flips cancelled out: one more)
        ld      hl,pwant
        cp      (hl)
        jr      nz,up2a
        xor     1
        ld      (preg),a
up2a:   ld      a,(preg)
up2:    ld      (preg),a
        call    showpw
        ld      hl,m_sag
        jp      logmsg

; upflip: one random bit of the register flipped
upflip: call    rnd
        and     7
        call    mask
        ld      hl,preg
        xor     (hl)
        ld      (hl),a
        ret

; upnext: the next trouble in 4-8 minutes (2400-4800 ticks)
upnext: call    rnd
        ld      l,a
        ld      h,0
        add     hl,hl
        add     hl,hl
        add     hl,hl
        ld      de,2400
        add     hl,de
        ld      (uptime),hl
        ret

; showpw: the PWR bar in the deck
showpw: ld      b,3
        ld      c,73
        call    gotoxy
        ld      a,(pwrlow)
        or      a
        ld      hl,m_pwok
        jp      z,puts
        call    revon
        ld      hl,m_pwlow
        call    puts
        jp      revoff

; fixpw: F at the dial
fixpw:  ld      a,(pwrlow)
        or      a
        ld      hl,m_pwfine
        jp      z,fx9
        ld      a,10
        ld      (mode),a
        call    drawpw
        ld      hl,m_pwopen
fx9:    call    logmsg
        jp      nokey

; fkey: the register's keys
fkey:   cp      ESC
        jr      z,fk8
        cp      'F'
        jr      z,fk8
        sub     '1'
        jp      c,nokey
        cp      8
        jp      nc,nokey
        ld      b,a             ; key 1 is bit 7
        ld      a,7
        sub     b
        call    mask
        ld      hl,preg
        xor     (hl)
        ld      (hl),a
        ld      hl,pwant
        cp      (hl)
        jr      z,fk5
        call    drawpw
        jp      nokey
fk5:    ld      a,ST_FIX
        call    stampit
        xor     a               ; set right
        ld      (pwrlow),a
        ld      (mode),a
        ld      a,BEL
        call    putc
        ld      hl,(tokens)
        ld      de,3
        add     hl,de
        ld      (tokens),hl
        call    showtk
        call    showpw
        call    drawpk
        ld      hl,m_pwok2
        call    logmsg
        jp      nokey
fk8:    xor     a
        ld      (mode),a
        call    drawpk
        ld      hl,m_pwlater
        call    logmsg
        jp      nokey

; drawpw: the register, in the packet box
drawpw: call    clrbox
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_pwhead
        call    puts
        xor     a
        call    setattr
        ld      b,PK_Y+2
        ld      c,5
        call    gotoxy
        ld      hl,m_pwnow
        call    puts
        ld      a,(preg)
        call    bits8
        ld      b,PK_Y+3
        ld      c,5
        call    gotoxy
        ld      hl,m_pwwant
        call    puts
        ld      a,(pwant)
        call    bits8
        ld      b,PK_Y+4
        ld      c,5
        call    gotoxy
        ld      hl,m_pwkeys
        jp      puts

; bits8: A as 8 binary digits, bit 7 first
bits8:  ld      c,a
        ld      b,8
b8_1:   ld      a,'0'
        rl      c
        adc     a,0
        call    putc
        djnz    b8_1
        ret

m_pwok: db      '######',0
m_pwlow: db     '##....',0
m_sag:  db      3
        dw      m_sag0, m_sag1, m_sag2
m_sag0: db      'The lights dip. PWR sags. (F when you have a moment.)',0
m_sag1: db      'A relay clicks and the power drops a notch. F to fix it.',0
m_sag2: db      'PWR is low: a byte in the power register has slipped. F.',0
m_pwfine: db    'The power is fine. PIXEL checked.',0
m_pwopen: db    'You open the power register. Set it to what the manual says.',0
m_pwok2: db     3
        dw      m_pwok20, m_pwok21, m_pwok22
m_pwok20: db    'Power back to full. The lights come up warm. (+3 tokens)',0
m_pwok21: db    'Click. Hum. PWR is full again. (+3 tokens)',0
m_pwok22: db    'Fixed. The kettle notices first. (+3 tokens)',0
m_pwlater: db   'The register can wait. The station hums on, a little slower.',0
m_pwhead: db    'THE POWER REGISTER',0
m_pwnow: db     'now:          ',0
m_pwwant: db    'the manual:   ',0
m_pwkeys: db    '1-8 flip a bit (1 is the left one)',0

pwrlow: db      0
uptime: dw      3000
preg:   db      0
pwant:  db      0
