; stamps.asm: sixteen small milestones. Included by sigseek.asm.
;
; stampit: A = a stamp; the first time, it is set and the log says so.
; K (at the dial, or in the Archive) shows the page of them. Kept in the
; save file (bytes 34-35).

NSTAMP  equ     16

stampit: push   af
        call    stbit
        and     (hl)
        jr      nz,sti9         ; had it
        pop     af
        push    af
        call    stbit
        or      (hl)
        ld      (hl),a
        ld      de,logbuf       ; "A stamp: <name>!"
        ld      hl,m_stamp
        call    strcpy
        pop     af
        push    af
        ld      hl,stnames
        call    msgof
        call    strcpy
        ld      a,'!'
        ld      (de),a
        inc     de
        xor     a
        ld      (de),a
        ld      a,BEL
        call    putc
        ld      hl,logbuf
        call    logmsg
sti9:   pop     af
        ret

; stbit: A = a stamp -> HL = its byte, A = its bit
stbit:  push    bc
        ld      c,a
        ld      hl,stamps
        bit     3,c
        jr      z,stb1
        inc     hl
stb1:   ld      a,c
        and     7
        call    mask
        pop     bc
        ret

; the page: K, from the dial or the Archive (mode 11)
stpage: ld      a,11
        ld      (mode),a
        call    clrbox
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_sthead
        call    puts
        xor     a
        call    setattr
        ld      c,0             ; count them
        ld      e,0
sp_1:   ld      a,e
        call    stbit
        and     (hl)
        jr      z,sp_2
        inc     c
sp_2:   inc     e
        ld      a,e
        cp      NSTAMP
        jr      nz,sp_1
        ld      a,c
        call    decn
        ld      hl,m_stof
        call    puts
        ld      e,0             ; four rows of four
sp_3:   ld      a,e
        srl     a
        srl     a
        add     a,PK_Y+1
        ld      b,a
        ld      a,e
        and     3
        ld      c,a             ; column 3 + 15 * (e mod 4)
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        sub     c
        add     a,3
        ld      c,a
        call    gotoxy
        push    de
        ld      a,e
        call    stbit
        and     (hl)
        jr      z,sp_4
        ld      a,A_REV         ; earned: reversed, with its star
        call    setattr
        ld      a,'*'
        jr      sp_5
sp_4:   ld      a,A_DIM         ; not yet: dim
        call    setattr
        ld      a,'.'
sp_5:   call    putc
        ld      a,' '
        call    putc
        pop     de
        push    de
        ld      a,e
        ld      hl,stnames
        call    msgof
        call    puts
        xor     a
        call    setattr
        pop     de
        inc     e
        ld      a,e
        cp      NSTAMP
        jr      nz,sp_3
        jp      nokey

; kkey: the page's keys: K or ESC back to the dial
kkey:   cp      'K'
        jr      z,kk1
        cp      ESC
        jp      nz,nokey
kk1:    xor     a
        ld      (mode),a
        call    drawpk
        jp      nokey

ST_CATCH equ    0
ST_CLEAN equ    1
ST_ROUTE equ    2
ST_LETTER equ   3
ST_ALL8 equ     4
ST_END  equ     5
ST_SHOP equ     6
ST_FRAG equ     7
ST_ARCH equ     8
ST_LAMP equ     9
ST_GHOST equ    10
ST_ECHO equ     11
ST_DAWN equ     12
ST_GIFT equ     13
ST_FIX  equ     14
ST_100  equ     15
stnames: dw     sn0, sn1, sn2, sn3, sn4, sn5, sn6, sn7, sn8, sn9, sn10, sn11, sn12, sn13, sn14, sn15
sn0:    db      'first catch',0
sn1:    db      'came clean',0
sn2:    db      'routed',0
sn3:    db      'a letter',0
sn4:    db      'all eight',0
sn5:    db      'a story told',0
sn6:    db      'shopping',0
sn7:    db      'a fragment',0
sn8:    db      'the Archive',0
sn9:    db      'the lantern',0
sn10:   db      'a ghost',0
sn11:   db      'an echo',0
sn12:   db      'dawn',0
sn13:   db      'a good gift',0
sn14:   db      'fixed it',0
sn15:   db      '100 tonight',0
m_stamp: db     'A stamp for the book: ',0
m_sthead: db    'STAMPS: ',0
m_stof: db      ' of 16',0
stamps: db      0,0

; all8: after a letter: has every caller written? (all chapters > 0)
all8:   ld      hl,chap
        ld      b,NCALL
a8_1:   ld      a,(hl)
        or      a
        ret     z
        inc     hl
        djnz    a8_1
        ld      a,ST_ALL8
        jp      stampit

; st100: after a delivery: 100 tokens tonight?
st100:  ld      hl,(tokens)
        ld      de,(tok0)
        or      a
        sbc     hl,de
        ld      de,100
        sbc     hl,de
        ret     c
        ld      a,ST_100
        jp      stampit
