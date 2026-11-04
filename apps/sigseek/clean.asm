; clean.asm: cleaning a captured packet, the bit-flip puzzle. Included
; by sigseek.asm.
;
; A packet is a short message with 1-3 noisy bytes: each has one bit
; flipped (bits 0-6; ASCII never sets bit 7). The packet box shows the
; hex, the text below it, and the selected byte's bits with its count
; of ones against the count it should have (the checksum). 1-8 flip a
; bit, , . (or left, right) pick a noisy byte, C or ESC put it aside.
; A clean packet is delivered: tokens, and the message in the log.

PK_MAX  equ     20

; ---------------------------------------------------------------- a new packet
newpk:  call    pick            ; a message: from whom, which
        ld      de,pkorig
        ld      bc,0
np1:    ld      a,(hl)
        ld      (de),a
        or      a
        jr      z,np2
        inc     hl
        inc     de
        inc     c
        jr      np1
np2:    ld      a,c
        ld      (pklen),a
        ld      hl,pkorig       ; the copy that gets the noise
        ld      de,pkcur
        inc     c
        ldir
        ld      hl,pknoisy
        ld      b,PK_MAX
        xor     a
np3:    ld      (hl),a
        inc     hl
        djnz    np3
        ld      hl,(freq)
        ld      (pkfrq),hl
; the noise: 1-2 bytes, one more when PIXEL is not purring
        call    rnd
        and     1
        inc     a
        ld      b,a
        ld      a,(purr)
        cp      3
        jr      nz,np4
        inc     b
np4:    ld      a,b
        ld      (pkleft),a
        ld      (pkbad),a
np5:    push    bc
np6:    call    rnd             ; a byte not yet noisy
        and     31
        ld      hl,pklen
        cp      (hl)
        jr      nc,np6
        ld      e,a
        ld      d,0
        ld      hl,pknoisy
        add     hl,de
        ld      a,(hl)
        or      a
        jr      nz,np6
        inc     (hl)
        ld      hl,pkcur
        add     hl,de
np7:    call    rnd             ; one of bits 0-6
        and     7
        cp      7
        jr      z,np7
        call    mask
        xor     (hl)
        ld      (hl),a
        pop     bc
        djnz    np5
        ld      a,1
        ld      (havepk),a
        jp      first

; first: select the first noisy byte
first:  ld      a,0ffh
        ld      (pksel),a
; next: select the next noisy byte after pksel (round)
next:   ld      a,(pklen)
        ld      b,a
        ld      a,(pksel)
nx1:    inc     a
        ld      hl,pklen
        cp      (hl)
        jr      c,nx2
        xor     a
nx2:    ld      e,a
        ld      d,0
        ld      hl,pknoisy
        add     hl,de
        ld      c,a
        ld      a,(hl)
        or      a
        ld      a,c
        jr      nz,nx3
        djnz    nx1
        ret
nx3:    ld      (pksel),a
        ret

; prev: the one before
prev:   ld      a,(pklen)
        ld      b,a
        ld      a,(pksel)
pv1:    or      a
        jr      nz,pv2
        ld      a,(pklen)
pv2:    dec     a
        ld      e,a
        ld      d,0
        ld      hl,pknoisy
        add     hl,de
        ld      c,a
        ld      a,(hl)
        or      a
        ld      a,c
        jr      nz,nx3
        djnz    pv1
        ret

; ---------------------------------------------------------------- the keys
clean:  ld      a,(havepk)
        or      a
        ld      hl,m_nopk
        jr      z,ck9
        ld      a,(pkleft)      ; clean already: only the routing is left
        or      a
        jp      z,route1
        ld      a,1
        ld      (mode),a
        call    drawpk
        ld      hl,m_clean
ck9:    call    logmsg
        jp      nokey

ckey:   cp      'C'
        jr      z,ckout
        cp      ESC
        jr      z,ckout
        cp      ','
        jr      z,ckprev
        cp      19
        jr      z,ckprev
        cp      '.'
        jr      z,cknext
        cp      4
        jr      z,cknext
        sub     '1'
        jp      c,nokey
        cp      8
        jp      nc,nokey
; flip: key 1 is bit 7 (shown first), key 8 is bit 0
        ld      b,a
        ld      a,7
        sub     b
        call    mask
        ld      c,a
        call    selptr          ; HL = pkcur + sel, DE = sel
        ld      a,(hl)
        xor     c
        ld      (hl),a
        ld      hl,pkorig
        add     hl,de
        cp      (hl)
        jr      nz,ckdraw
; that byte is clean
        ld      hl,pknoisy
        add     hl,de
        ld      (hl),0
        ld      a,BEL
        call    putc
        ld      hl,pkleft
        dec     (hl)
        jr      z,cdone
        ld      hl,m_byte
        call    logmsg
        call    next
        jr      ckdraw
; all clean: a caller's packet still has to be routed to them
cdone:  ld      a,(pkkind)
        cp      K_CALL
        jp      z,route0
        jp      deliv
ckprev: call    prev
        jr      ckdraw
cknext: call    next
ckdraw: call    drawpk
        jp      nokey
ckout:  xor     a
        ld      (mode),a
        call    drawpk
        ld      hl,m_aside
        call    logmsg
        jp      nokey

; mask: A = 1 shl A (A = 0..7)
mask:   ld      b,a
        inc     b
        xor     a
        scf
mk1:    rla
        djnz    mk1
        ret

; selptr: HL = pkcur + pksel, DE = pksel
selptr: ld      a,(pksel)
        ld      e,a
        ld      d,0
        ld      hl,pkcur
        add     hl,de
        ret

; ---------------------------------------------------------------- delivery
; tokens: 5 for the packet, 3 for each byte that was noisy
deliv:  xor     a
        ld      (mode),a
        ld      (havepk),a
        ld      (fullms),a
        ld      a,(pkbad)
        ld      b,a
        add     a,a
        add     a,b
        add     a,5
        ld      b,a
        ld      a,(pkkind)      ; and 4 more for routing a caller's
        cp      K_CALL
        ld      a,b
        jr      nz,dv1
        add     a,4
dv1:    ld      (pkgain),a
        ld      e,a
        ld      d,0
        ld      hl,(tokens)
        add     hl,de
        ld      (tokens),hl
        call    showtk
        ld      a,BEL
        call    putc
; the log: Delivered (+NN): <the message>
        ld      de,logbuf
        ld      hl,m_deliv
        call    strcpy
        ld      a,(pkgain)
        ld      b,'0'-1
dl1:    inc     b
        sub     10
        jr      nc,dl1
        add     a,10+'0'
        ex      de,hl
        ld      (hl),b
        inc     hl
        ld      (hl),a
        inc     hl
        ex      de,hl
        ld      hl,m_deliv2
        call    strcpy
        ld      hl,pkorig
        call    strcpy
        xor     a
        ld      (de),a
        ld      hl,logbuf
        call    logmsg
        call    drawpk
        call    story           ; the letter, or the fragment
        jp      nokey

; strcpy: HL (0-terminated) to DE, DE left on the end
strcpy: ld      a,(hl)
        or      a
        ret     z
        ld      (de),a
        inc     hl
        inc     de
        jr      strcpy

; showtk: tokens in the deck box (row 5, columns 75-78)
showtk: xor     a
        ld      (lead),a
        ld      b,5
        ld      c,75
        call    gotoxy
        ld      hl,(tokens)
        ld      de,1000
        call    dgs
        ld      de,100
        call    dgs
        ld      de,10
        call    dgs
        ld      a,l
        add     a,'0'
        jp      putc
; dgs: a digit of HL by DE, a space for a leading zero
dgs:    ld      a,'0'-1
dgs1:   inc     a
        or      a
        sbc     hl,de
        jr      nc,dgs1
        add     hl,de
        cp      '0'
        jr      nz,dgs2
        ld      b,a
        ld      a,(lead)
        or      a
        ld      a,b
        jr      nz,dgs3
        ld      a,' '
        jp      putc
dgs2:   ld      b,a
        ld      a,1
        ld      (lead),a
        ld      a,b
dgs3:   jp      putc

; ---------------------------------------------------------------- the box
; drawpk: the packet box, rows 7-10. No packet: the idle line. A packet
; put aside: a note. Cleaning: hex, text, the selected byte's bits.
drawpk: ld      b,7
dk0:    ld      c,2
        call    gotoxy
        ld      d,SPEC_W
dk1:    ld      a,' '
        call    putc
        dec     d
        jr      nz,dk1
        inc     b
        ld      a,b
        cp      11
        jr      nz,dk0
        ld      b,8
        ld      c,16
        call    gotoxy
        ld      a,(havepk)
        or      a
        ld      hl,m_idle
        jp      z,puts
        ld      a,(mode)
        or      a
        ld      hl,m_wait
        jp      z,puts
; row 7: where it came from, how much noise is left
        ld      b,7
        ld      c,3
        call    gotoxy
        ld      hl,m_from
        call    puts
        ld      hl,(pkfrq)
        call    dec5
        ld      hl,m_noisy
        call    puts
        ld      a,(pkleft)
        call    decn
; row 8: hex, with '>' before the selected byte; row 9: the text, '*'
; after a noisy byte
        ld      a,(pklen)
        ld      d,a
        ld      e,0
dk2:    ld      a,e             ; column 3 + 3i
        add     a,a
        add     a,e
        add     a,3
        ld      c,a
        ld      b,8
        dec     c
        call    gotoxy
        ld      a,(pksel)
        cp      e
        ld      a,' '
        jr      nz,dk3
        ld      a,'>'
dk3:    call    putc
        push    de
        ld      d,0
        ld      hl,pkcur
        add     hl,de
        ld      a,(hl)
        call    hex2
        inc     c
        ld      b,9
        call    gotoxy
        ld      a,(hl)
        cp      ' '
        jr      c,dk4
        cp      127
        jr      c,dk5
dk4:    ld      a,'?'
dk5:    call    putc
        ld      hl,pknoisy
        add     hl,de
        ld      a,(hl)
        or      a
        ld      a,' '
        jr      z,dk6
        ld      a,'*'
dk6:    call    putc
        pop     de
        inc     e
        dec     d
        jr      nz,dk2
; row 10: the bits of the selected byte, ones now / ones wanted
        ld      b,10
        ld      c,3
        call    gotoxy
        call    selptr
        ld      a,(hl)
        ld      c,a
        ld      hl,pkorig       ; H = the wrong bits, if hints are bought
        add     hl,de
        xor     (hl)
        ld      h,a
        ld      a,(upg)
        and     U_HINT
        jr      nz,dk6a
        ld      h,a
dk6a:   ld      b,8
dk7:    ld      a,'0'
        rl      c
        adc     a,0
        rl      h
        jr      nc,dk7a
        ld      a,'!'
dk7a:   call    putc
        djnz    dk7
        ld      hl,m_ones
        call    puts
        call    selptr
        ld      a,(hl)
        call    ones
        call    decn
        ld      a,'/'
        call    putc
        ld      hl,pkorig
        add     hl,de
        ld      a,(hl)
        call    ones
        call    decn
        ld      hl,m_ckeys
        jp      puts

; ones: A = the count of 1 bits in A
ones:   push    bc
        ld      c,a
        xor     a
        ld      b,8
on1:    rr      c
        adc     a,0
        djnz    on1
        pop     bc
        ret

; hex2: A as two hex digits
hex2:   push    af
        rrca
        rrca
        rrca
        rrca
        call    hex1
        pop     af
hex1:   and     15
        add     a,'0'
        cp      '9'+1
        jr      c,hx1
        add     a,7
hx1:    jp      putc

; ---------------------------------------------------------------- data
m_idle: db      '(no signal captured)',0
m_wait: db      'A packet waits in the buffer. Press C.',0
m_from: db      'From ',0
m_noisy: db     ' MHz.  Noisy bytes left: ',0
m_ones: db      '  ones ',0
m_ckeys: db     '   1-8 flip  ,. pick  C later',0
m_nopk: db      'Nothing in the buffer to clean. Tune in a signal first.',0
m_clean: db     'Cleaning. Make the ones match: 1-8 flip a bit.',0
m_byte: db      'That byte is clean. Next one.',0
m_aside: db     'Packet put aside. It will wait.',0
m_deliv: db     'Delivered (+',0
m_deliv2: db    '): ',0

mode:   db      0               ; 1: cleaning
havepk: db      0
pklen:  db      0
pksel:  db      0
pkleft: db      0
pkbad:  db      0
pkgain: db      0
pkfrq:  dw      0
tokens: dw      0
lead:   db      0
pkorig: ds      PK_MAX+1
pkcur:  ds      PK_MAX+1
pknoisy: ds     PK_MAX
logbuf: ds      64
