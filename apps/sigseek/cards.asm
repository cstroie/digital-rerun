; cards.asm: postcards from the callers. Included by sigseek.asm.
;
; When a caller's story comes to its fifth chapter, they send a postcard
; too: a caption and a small picture, from SIGSEEK.DAT (strings X_CARD +
; 5c: the caption, then four lines). W shows the postcard wall, if the
; shop's postcard wall is up: one card at a time, , . to turn through
; them, W or ESC to close. The shelf shows the wall with a # for each.

NCARD   equ     8
X_CARD  equ     X_FRAG+NFRAG*2

; gotcard: caller A has sent their postcard (when their story ends)
gotcard: push   af
        ld      a,ST_END
        call    stampit
        call    mask
        ld      hl,cards
        or      (hl)
        ld      (hl),a
        ld      a,BEL
        call    putc
        pop     af
        push    af
        call    cname           ; "<name> sent you a postcard!"
        pop     af
        ld      de,logbuf
        call    strcpy
        ld      a,(upg)
        and     U_CARDS
        ld      hl,m_gcard
        jr      nz,gc1
        ld      hl,m_gcard2     ; (no wall to pin it on yet)
gc1:    call    strcpy
        xor     a
        ld      (de),a
        call    shelf
        ld      hl,logbuf
        jp      logmsg

; cname: A = a caller -> HL = their name up to its first comma, copied
; to cnbuf (0-terminated)
cname:  add     a,a
        add     a,a
        add     a,a
        add     a,a
        ld      l,a
        ld      h,0
        ld      de,X_CALL
        add     hl,de
        call    str
        ld      de,cnbuf
cn1:    ld      a,(hl)
        or      a
        jr      z,cn2
        cp      ','
        jr      z,cn2
        ld      (de),a
        inc     hl
        inc     de
        jr      cn1
cn2:    xor     a
        ld      (de),a
        ld      hl,cnbuf
        ret

; hascard: is card A in? NZ if so
hascard: push   bc
        call    mask
        ld      hl,cards
        and     (hl)
        pop     bc              ; (pop keeps the flags)
        ret

; ---------------------------------------------------------------- the wall
wall:   ld      a,(upg)
        and     U_CARDS
        ld      hl,m_nowall
        jr      z,wl9
        ld      a,(cards)
        or      a
        ld      hl,m_nocard
        jr      z,wl9
        ld      a,6
        ld      (mode),a
        ld      a,NCARD-1       ; the first one in
        ld      (csel),a
        call    cnext
        call    drawwl
        ld      hl,m_wall
wl9:    call    logmsg
        jp      nokey

wkey:   cp      'W'
        jr      z,wkout
        cp      ESC
        jr      z,wkout
        cp      ','
        jr      z,wkprev
        cp      19
        jr      z,wkprev
        cp      '.'
        jr      z,wknext
        cp      4
        jr      z,wknext
        jp      nokey
wknext: call    cnext
        jr      wkdraw
wkprev: ld      b,NCARD         ; the one before
wp1:    ld      a,(csel)
        dec     a
        and     NCARD-1
        ld      (csel),a
        call    hascard
        jr      nz,wkdraw
        djnz    wp1
wkdraw: call    drawwl
        jp      nokey
wkout:  xor     a
        ld      (mode),a
        call    drawpk
        jp      nokey

; cnext: the card after csel that is in
cnext:  ld      b,NCARD
cx1:    ld      a,(csel)
        inc     a
        and     NCARD-1
        ld      (csel),a
        call    hascard
        ret     nz
        djnz    cx1
        ret

; drawwl: the card: its caption (bold), who from and how many, the
; picture under it
drawwl: call    clrbox
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      a,(csel)        ; the caption: string X_CARD + 5c
        ld      b,a
        add     a,a
        add     a,a
        add     a,b
        ld      l,a
        ld      h,0
        ld      de,X_CARD
        add     hl,de
        call    str
        call    puts
        push    hl
        xor     a
        call    setattr
        ld      hl,m_cfrom
        call    puts
        ld      a,(csel)
        call    cname
        call    puts
        pop     hl
        call    skipz           ; the picture
        ld      b,PK_Y+1
dw1:    push    bc
        call    putrow
        call    skipz
        pop     bc
        inc     b
        ld      a,b
        cp      PK_Y+5
        jr      nz,dw1
        ret

; shelfc: the wall's cards on the shelf, a # for each (and . for not yet)
shelfc: ld      a,'['
        call    putc
        ld      c,0
sc_1:   ld      a,c
        call    hascard
        ld      a,'.'
        jr      z,sc_2
        ld      a,'#'
sc_2:   call    putc
        inc     c
        ld      a,c
        cp      NCARD
        jr      nz,sc_1
        ld      a,']'
        jp      putc

m_gcard: db     ' sent you a postcard! (W: the wall)',0
m_gcard2: db    ' sent you a postcard! (the shop has a wall for it)',0
m_nowall: db    'Postcards need a wall to go on. The shop has one.',0
m_nocard: db    'The wall is bare, for now. Callers send cards in the end.',0
m_wall: db      'The postcard wall.',0
m_cfrom: db     '  - ',0

cards:  db      0
csel:   db      0
cnbuf:  ds      32
