; print.asm: the FX-80. Included by sigseek.asm.
;
; L in the Archive prints every fragment kept; L on the postcard wall
; prints the card shown. To LST: through the BDOS (function 5), which is
; DigitalRerun's FX-80; a heading in emphasized type (ESC E, ESC F), and
; a form feed at the end of the page.

lchar:  push    bc
        push    de
        push    hl
        ld      e,a
        ld      c,5
        call    BDOS
        pop     hl
        pop     de
        pop     bc
        ret
lputs:  ld      a,(hl)
        or      a
        ret     z
        call    lchar
        inc     hl
        jr      lputs
lcrlf:  ld      a,CR
        call    lchar
        ld      a,LF
        jp      lchar
lbold:  ld      a,ESC
        call    lchar
        ld      a,'E'
        jp      lchar
lplain: ld      a,ESC
        call    lchar
        ld      a,'F'
        jp      lchar
; lhead: HL, emphasized, on its own line, and a blank one after
lhead:  call    lbold
        call    lputs
        call    lplain
        call    lcrlf
        jp      lcrlf
; ldec: A in decimal
ldec:   ld      b,'0'-1
ld_1:   inc     b
        sub     10
        jr      nc,ld_1
        add     a,10+'0'
        push    af
        ld      a,b
        cp      '0'
        call    nz,lchar
        pop     af
        jp      lchar

; parch: the Archive, kept fragments only
parch:  ld      hl,m_parch
        call    lbold
        call    lputs
        ld      a,(shift)
        call    ldec
        call    lplain
        call    lcrlf
        call    lcrlf
        ld      c,0
pa_1:   ld      a,c
        call    archas
        jr      z,pa_2
        push    bc
        ld      a,c
        inc     a
        call    ldec
        ld      hl,m_psp
        call    lputs
        pop     bc
        push    bc
        ld      a,c
        call    fragtx
        call    skipz
        call    lputs
        call    lcrlf
        pop     bc
pa_2:   inc     c
        ld      a,c
        cp      NFRAG
        jr      nz,pa_1
        jr      pend

; pcard: the postcard shown on the wall
pcard:  ld      a,(csel)        ; the caption: string X_CARD + 5c
        ld      b,a
        add     a,a
        add     a,a
        add     a,b
        ld      l,a
        ld      h,0
        ld      de,X_CARD
        add     hl,de
        call    str
        push    hl
        call    lhead
        pop     hl
        call    skipz
        ld      b,4             ; the picture
pc_1:   push    bc
        ld      a,' '
        call    lchar
        call    lputs
        call    lcrlf
        call    skipz
        pop     bc
        djnz    pc_1
        call    lcrlf
        ld      hl,m_pfrom
        call    lputs
        ld      a,(csel)
        call    cname
        call    lputs
        call    lcrlf
pend:   call    lcrlf
        ld      hl,m_pfoot
        call    lputs
        call    lcrlf
        ld      a,12            ; form feed: the page out
        call    lchar
        ld      hl,m_ptd
        jp      logmsg

m_parch: db     'THE ARCHIVE OF THE LANTERN BEACONS - kept at Relay Kettle-7, shift ',0
m_psp:  db      '.  ',0
m_pfrom: db     '   - from ',0
m_pfoot: db     '   Relay Station Kettle-7, the edge of the Lantern Nebula',0
m_ptd:  db      3
        dw      m_ptd0, m_ptd1, m_ptd2
m_ptd0: db      'The printer clatters. A page for the wall at home.',0
m_ptd1: db      'Printed. PIXEL watches the paper come out, suspicious.',0
m_ptd2: db      'A page rolls out of the FX-80, warm and a little curly.',0
