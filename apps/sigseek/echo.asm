; echo.asm: echoes. Included by sigseek.asm.
;
; A message delivered tonight (from a caller, or from nobody) is kept;
; on a later night it may come back, fainter, from farther out: one of
; the messages from nobody, now and then, is the echo instead. Delivered,
; it shows who passed it on and what they added, and the slot is free
; for the next. Kept in the save file (bytes 40-62).

K_ECHO  equ     5

; echkeep: after a delivery: keep it, if no echo is waiting
echkeep: ld     a,(pkkind)
        cp      K_MSG
        jr      z,ek1
        cp      K_CALL
        ret     nz
ek1:    ld      a,(eflag)
        or      a
        ret     nz
        ld      hl,pkorig
        ld      de,etext
        ld      bc,21
        ldir
        ld      a,(shift)
        ld      (eshift),a
        ld      a,1
        ld      (eflag),a
        ret

; echoq: Z if an echo is waiting from an earlier night
echoq:  ld      a,(eflag)
        or      a
        jr      z,eq9
        ld      a,(eshift)
        ld      b,a
        ld      a,(shift)
        cp      b
        jr      z,eq9
        xor     a               ; Z: yes
        ret
eq9:    or      1               ; NZ: no
        ret

; estory: the echo delivered: where it came from, who passed it on
estory: call    clrbox
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_ehead
        call    puts
        ld      a,(eshift)
        call    decn
        xor     a
        call    setattr
        ld      b,PK_Y+1
        ld      c,5
        call    gotoxy
        ld      a,'"'
        call    putc
        ld      hl,etext
        call    puts
        ld      a,'"'
        call    putc
        call    rnd             ; who passed it on, and what they say
        and     7
        ld      (erelay),a
        ld      hl,relays
        call    msgof
        push    hl
        ld      b,PK_Y+3
        ld      c,3
        call    gotoxy
        ld      hl,m_eby
        call    puts
        pop     hl
        call    puts
        ld      a,'.'
        call    putc
        ld      a,(erelay)
        ld      hl,eadds
        call    msgof
        push    hl
        ld      b,PK_Y+4
        ld      c,3
        call    gotoxy
        ld      a,A_DIM
        call    setattr
        pop     hl
        call    puts
        xor     a
        call    setattr
        ld      a,ST_ECHO
        call    stampit
        xor     a               ; the slot is free
        ld      (eflag),a
        ld      hl,m_elog
        jp      logmsg

m_ehead: db     'AN ECHO, back from farther out. First sent on shift ',0
m_eby:  db      'Passed on by ',0
m_elog: db      3
        dw      m_elog0, m_elog1, m_elog2
m_elog0: db     'An echo came home, a little worn, and with company.',0
m_elog1: db     'Something you sent came back, the long way round.',0
m_elog2: db     'Your old message, passed hand to hand across the dark.',0
relays: dw      r0, r1, r2, r3, r4, r5, r6, r7
r0:     db      'Relay Juniper, on the Ceres line',0
r1:     db      'the night crew at Tycho',0
r2:     db      'a weather buoy past Io',0
r3:     db      'Kettle-12, three nebulae over',0
r4:     db      'a mining tug, just passing',0
r5:     db      'the Lighthouse Seven lamp-relay',0
r6:     db      'somebody called Dot, who signs with a star',0
r7:     db      'an old probe that still answers',0
eadds:  dw      a0, a1, a2, a3, a4, a5, a6, a7
a0:     db      'They add: "Received with thanks. Sending it on."',0
a1:     db      'They add: "Tea was had in your honour."',0
a2:     db      'They add: "Raining here. Thought you should know."',0
a3:     db      'They add: "Our cat says hello to your cat."',0
a4:     db      'They add: "Nice signal, Kettle-7. Clean as anything."',0
a5:     db      'They add: "Keeping the light on for you."',0
a6:     db      'They add: "* * *"',0
a7:     db      'They add: "beep. (I am a probe.) beep."',0

eflag:  db      0
eshift: db      0
etext:  ds      21
erelay: db      0
