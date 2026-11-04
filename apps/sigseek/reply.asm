; reply.asm: answering the callers. Included by sigseek.asm.
;
; After a caller's letter, if their story is not over, a reply: 1 a warm
; one, 2 a word from PIXEL, 3 (or ESC) none. Their next letter has a
; P.S. that answers it, in the packet box's fourth row. Kept per caller
; in the save file (bytes 26-33).

; askrep: after a caller's letter: offer a reply (mode 9)
askrep: ld      a,(pkch)        ; the last letter: nothing to answer
        cp      NCH-1
        ret     nc
        ld      a,9
        ld      (mode),a
        ld      a,(pkwho)
        call    cname
        ld      de,logbuf
        push    hl
        ld      hl,m_rq1
        call    strcpy
        pop     hl
        call    strcpy
        ld      hl,m_rq2
        call    strcpy
        xor     a
        ld      (de),a
        ld      hl,logbuf
        jp      logmsg

; qkey: the reply's keys
qkey:   cp      ESC
        jr      z,qk3
        sub     '1'
        jp      c,nokey
        cp      3
        jp      nc,nokey
        cp      2
        jr      z,qk3
        inc     a               ; 1 warm, 2 from PIXEL
        ld      b,a
        ld      a,(pkwho)
        ld      e,a
        ld      d,0
        ld      hl,reps
        add     hl,de
        ld      (hl),b
        ld      a,b
        dec     a
        ld      hl,m_rsent
        call    msgof
        push    bc
        call    logmsg
        pop     bc
        ld      a,b             ; a word from PIXEL: she is smug about it
        cp      2
        jr      nz,qk4
        ld      a,MD_SMUG
        ld      (cmood),a
        call    showmd
        jr      qk4
qk3:    ld      hl,m_rnone
        call    logmsg
qk4:    xor     a
        ld      (mode),a
        jp      nokey

; psline: in the caller's letter: a P.S. if they had a reply
psline: ld      a,(pkwho)
        ld      e,a
        ld      d,0
        ld      hl,reps
        add     hl,de
        ld      a,(hl)
        or      a
        ret     z
        ld      (hl),0          ; answered
        dec     a               ; 2i + (reply - 1)
        ld      b,a
        ld      a,(pkwho)
        add     a,a
        add     a,b
        ld      hl,pss
        call    msgof
        push    hl
        ld      b,PK_Y+3
        ld      c,3
        call    gotoxy
        pop     hl
        jp      puts

m_rq1:  db      'Reply to ',0
m_rq2:  db      '? 1: a warm reply   2: a word from PIXEL   3: no reply',0
m_rsent: dw     m_rs1, m_rs2
m_rs1:  db      3
        dw      m_rs1a, m_rs1b, m_rs1c
m_rs1a: db      'You send a warm reply. It goes out on the next relay.',0
m_rs1b: db      'You write back: short, kind, true. Sent.',0
m_rs1c: db      'A reply goes out from Kettle-7, with your best wishes.',0
m_rs2:  db      3
        dw      m_rs2a, m_rs2b, m_rs2c
m_rs2a: db      'You send a word from PIXEL. (It was mostly the letter m.)',0
m_rs2b: db      'PIXEL steps on the key. You send that. It is perfect.',0
m_rs2c: db      'A reply from PIXEL goes out: one paw, pressed firmly.',0
m_rnone: db     2
        dw      m_rn1, m_rn2
m_rn1:  db      'No reply tonight. They will write again anyway.',0
m_rn2:  db      'You let the letter be. Some letters just want reading.',0
pss:    dw      ps0a, ps0b, ps1a, ps1b, ps2a, ps2b, ps3a, ps3b, ps4a, ps4b, ps5a, ps5b, ps6a, ps6b, ps7a, ps7b
ps0a:   db      'P.S. Your reply came through. I read it twice. Thank you.',0
ps0b:   db      'P.S. Tell PIXEL I saw a cat-shaped comet. It was for her.',0
ps1a:   db      'P.S. I read your note to the lamp. It burned brighter.',0
ps1b:   db      'P.S. A cat! The lighthouse could use a cat. Or a dog.',0
ps2a:   db      'P.S. YOU WROTE BACK. I am keeping it forever.',0
ps2b:   db      'P.S. PIXEL SAID HI?? best day. hi PIXEL',0
ps3a:   db      'P.S. REPLY RECEIVED. LOGGED UNDER: GOOD THINGS.',0
ps3b:   db      'P.S. GREETINGS TO THE CAT UNIT. MMMMMM TO YOU TOO.',0
ps4a:   db      'P.S. Kind of you to write. The ferns hummed at it.',0
ps4b:   db      'P.S. The ferns go quiet when I read out PIXEL',27h,'s part.',0
ps5a:   db      'P.S. Dee wrote a verse about your reply. It rhymes!',0
ps5b:   db      'P.S. Sol wants a cat now. Dee says the shuttle is small.',0
ps6a:   db      'P.S. Good to hear a steady voice on the old routes.',0
ps6b:   db      'P.S. My regards to the station cat. Cats keep stations.',0
ps7a:   db      'P.S. You wrote to me. I did not know anyone could.',0
ps7b:   db      'P.S. Tell PIXEL I hum back at her, very low.',0
reps:   ds      8               ; each caller's reply waiting: 0 none, 1 warm, 2 PIXEL
