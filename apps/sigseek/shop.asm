; shop.asm: the station shop, the shelf of decorations, and the save
; file. Included by sigseek.asm.
;
; The shop (S) fills the packet box: eight things, bought with tokens,
; once each. Four make the work gentler, four make the station cozier
; and sit on the shelf (row 17). Nothing makes anything harder.

U_TUNER equ     01h             ; one step off the peak counts as on
U_HINT  equ     02h             ; the wrong bits show as !
U_HEAT  equ     04h             ; PIXEL purrs in any mood at home
U_BUF   equ     08h             ; the buffer fills twice as fast
U_KETTLE equ    10h
U_PLANT equ     20h
U_LAMP  equ     40h
U_CARDS equ     80h

; ---------------------------------------------------------------- the shop
shop:   ld      a,2
        ld      (mode),a
        call    drawsh
        ld      hl,m_shop
        call    logmsg
        jp      nokey

skey:   cp      'S'
        jr      z,skout
        cp      ESC
        jr      z,skout
        cp      '0'             ; 0 is the tenth
        ld      b,9
        jr      z,sk0
        sub     '1'
        jp      c,nokey
        cp      9
        jp      nc,nokey
        ld      b,a
sk0:    ld      a,b
        ld      (sitem),a
        ld      (sbuy),a        ; (sitem is the drawing loops' too)
        call    itemhl
        and     (hl)
        ld      hl,m_have
        jr      nz,sklog
        ld      a,(sitem)       ; the price
        ld      hl,prices
        add     a,l
        ld      l,a
        jr      nc,sk1
        inc     h
sk1:    ld      e,(hl)
        ld      d,0
        ld      hl,(tokens)
        or      a
        sbc     hl,de
        ld      hl,m_poor
        jr      c,sklog
        ld      hl,(tokens)
        sbc     hl,de
        ld      (tokens),hl
        ld      a,(sitem)
        call    itemhl
        or      (hl)
        ld      (hl),a
        ld      a,BEL
        call    putc
        call    showtk
        call    shelf
        call    pose            ; (a new heater shows at once)
        call    drawsh
        ld      a,ST_SHOP
        call    stampit
        call    save
        ld      a,(sbuy)
        ld      hl,bought
        call    msgof
sklog:  call    logmsg
        jp      nokey
skout:  xor     a
        ld      (mode),a
        call    drawpk
        ld      hl,m_shut
        jr      sklog

; itemhl: A = an item -> HL = its byte (upg, or upg2 from the ninth),
; A = its bit
itemhl: push    bc
        ld      hl,upg
        cp      8
        jr      c,ih1
        ld      hl,upg2
        sub     8
ih1:    call    mask
        pop     bc
        ret

; drawsh: two columns of five, in the packet box
drawsh: ld      b,PK_Y
ds0:    ld      c,2
        call    gotoxy
        ld      d,SPEC_W
ds1:    ld      a,' '
        call    putc
        dec     d
        jr      nz,ds1
        inc     b
        ld      a,b
        cp      PK_Y+5
        jr      nz,ds0
        xor     a
ds2:    ld      (sitem),a
        ld      c,4             ; the first five on the left
        cp      5
        jr      c,ds2a
        sub     5
        ld      c,35
ds2a:   add     a,PK_Y
        ld      b,a
ds3:    call    gotoxy
        ld      a,(sitem)       ; its key: 1-9, then 0
        inc     a
        cp      10
        jr      c,ds3a
        xor     a
ds3a:   add     a,'0'
        call    putc
        ld      a,' '
        call    putc
        ld      a,(sitem)
        ld      hl,names
        call    msgof
        call    puts
        ld      a,(sitem)       ; the price, or got
        call    itemhl
        and     (hl)
        ld      hl,m_got2
        jr      nz,ds4
        ld      a,(sitem)
        ld      hl,prices
        add     a,l
        ld      l,a
        jr      nc,ds5
        inc     h
ds5:    ld      a,(hl)
        call    dec3
        ld      hl,m_tok
ds4:    call    puts
        ld      a,(sitem)
        inc     a
        cp      NITEM
        jr      nz,ds2
        ret

; dec3: A as three digits, a space for a leading zero
dec3:   ld      b,'0'-1
d31:    inc     b
        sub     100
        jr      nc,d31
        add     a,100
        push    af
        ld      a,b
        cp      '0'
        jr      nz,d32
        ld      a,' '
d32:    call    putc
        pop     af
        jp      dec2

; ---------------------------------------------------------------- the shelf
; row 17: what has been bought for the station, each in its place
shelf:  ld      b,23
        ld      c,3
        call    gotoxy
        ld      hl,m_shelf
        call    puts
        ld      a,4
sh1:    ld      (sitem),a
        call    mask
        ld      c,a
        ld      a,(upg)
        and     c
        jr      z,sh2
        ld      a,(sitem)       ; each in its place (PIXEL sits on them)
        sub     4
        ld      c,a
        add     a,a
        add     a,a
        add     a,a
        sub     c
        sub     c               ; 6 * (item - 4)
        add     a,10
        ld      c,a
        ld      b,23
        call    gotoxy
        ld      a,(sitem)
        ld      hl,decor
        call    msgof
        call    puts
        ld      a,(sitem)       ; the wall: its cards
        cp      7
        call    z,shelfc
sh2:    ld      a,(sitem)
        inc     a
        cp      8
        jr      nz,sh1
        ret

; ---------------------------------------------------------------- the save file
; SIGSEEK.SAV, one record: 'SG', version, terminal, seed, tokens,
; upgrades, packets, shift, PIXEL's mood.
SV_VER  equ     8               ; 1: before the callers; 2: flags; 3: cards; 4: echo; 5: replies; 6: stamps; 7: upg2

; load: at start. A new shift begins: shift + 1.
load:   call    fcbclr
        ld      de,savbuf
        ld      c,26            ; set DMA
        call    BDOS
        ld      de,fcb
        ld      c,15            ; open
        call    BDOS
        inc     a
        jp      z,ld9
        ld      de,fcb
        ld      c,20            ; read sequential
        call    BDOS
        push    af
        ld      de,fcb
        ld      c,16            ; close
        call    BDOS
        pop     af
        or      a
        jp      nz,ld9
        ld      hl,(savbuf)
        ld      de,'G'*256+'S'
        or      a
        sbc     hl,de
        jp      nz,ld9
        ld      a,(savbuf+2)
        cp      1
        jr      z,ld8           ; version 1: no story yet
        cp      SV_VER+1
        jp      nc,ld9
        push    af
        ld      hl,savbuf+12    ; the callers' chapters, the Archive
        ld      de,chap
        ld      bc,NCALL+NFRAG/8
        ldir
        pop     af
        cp      3               ; version 3: the flags (the lantern, the end)
        jr      c,ld8
        push    af
        ld      a,(savbuf+24)
        ld      (flags),a
        pop     af
        cp      4               ; version 4: the postcards
        jr      c,ld8
        push    af
        ld      a,(savbuf+25)
        ld      (cards),a
        pop     af
        cp      5               ; version 5: an echo waiting
        jr      c,ld8
        push    af
        ld      hl,savbuf+40
        ld      de,eflag
        ld      bc,23
        ldir
        pop     af
        cp      6               ; version 6: replies waiting
        jr      c,ld8
        push    af
        ld      hl,savbuf+26
        ld      de,reps
        ld      bc,8
        ldir
        pop     af
        cp      7               ; version 7: the stamp book
        jr      c,ld8
        ld      hl,(savbuf+34)
        ld      (stamps),hl
        cp      8               ; version 8: the ninth and tenth items
        jr      c,ld8
        ld      a,(savbuf+36)
        ld      (upg2),a
ld8:
        ld      a,(savbuf+3)
        ld      (term),a
        ld      hl,(savbuf+4)
        ld      (rseed),hl
        ld      hl,(savbuf+6)
        ld      (tokens),hl
        ld      a,(savbuf+8)
        ld      (upg),a
        ld      a,(savbuf+9)
        ld      (npkt),a
        ld      a,(savbuf+11)
        ld      (cmood),a
        ld      a,(savbuf+10)
        inc     a
        ld      (shift),a
        ret
ld9:    ld      a,1
        ld      (shift),a
        ret

; save: at quit and after buying
save:   ld      hl,savbuf       ; the record
        ld      b,128
sv0:    ld      (hl),1ah
        inc     hl
        djnz    sv0
        ld      hl,'G'*256+'S'
        ld      (savbuf),hl
        ld      a,SV_VER
        ld      (savbuf+2),a
        ld      a,(term)
        ld      (savbuf+3),a
        ld      hl,(rseed)
        ld      (savbuf+4),hl
        ld      hl,(tokens)
        ld      (savbuf+6),hl
        ld      a,(upg)
        ld      (savbuf+8),a
        ld      a,(npkt)
        ld      (savbuf+9),a
        ld      a,(shift)
        ld      (savbuf+10),a
        ld      a,(cmood)
        ld      (savbuf+11),a
        ld      hl,chap         ; the callers' chapters, the Archive
        ld      de,savbuf+12
        ld      bc,NCALL+NFRAG/8
        ldir
        ld      a,(flags)
        ld      (savbuf+24),a
        ld      a,(cards)
        ld      (savbuf+25),a
        ld      hl,eflag        ; an echo waiting
        ld      de,savbuf+40
        ld      bc,23
        ldir
        ld      hl,reps         ; replies waiting
        ld      de,savbuf+26
        ld      bc,8
        ldir
        ld      hl,(stamps)     ; the stamp book
        ld      (savbuf+34),hl
        ld      a,(upg2)
        ld      (savbuf+36),a
        ld      de,savbuf
        ld      c,26
        call    BDOS
        call    fcbclr
        ld      de,fcb
        ld      c,19            ; delete the old one
        call    BDOS
        call    fcbclr
        ld      de,fcb
        ld      c,22            ; make
        call    BDOS
        inc     a
        ret     z               ; no room: no save, no fuss
        ld      de,fcb
        ld      c,21            ; write sequential
        call    BDOS
        ld      de,fcb
        ld      c,16            ; close
        jp      BDOS

; fcbclr: the FCB past its name back to zeros
fcbclr: ld      hl,fcb+12
        ld      b,24
fc1:    ld      (hl),0
        inc     hl
        djnz    fc1
        ret

; ---------------------------------------------------------------- data
NITEM   equ     10
prices: db      60, 120, 75, 105, 45, 30, 60, 90, 80, 150
names:  dw      n0,n1,n2,n3,n4,n5,n6,n7,n8,n9
n8:     db      'Star chart     ',0
n9:     db      'Second buffer  ',0
n0:     db      'Fine tuner     ',0
n1:     db      'Bit hints      ',0
n2:     db      'Good heater    ',0
n3:     db      'Big buffer     ',0
n4:     db      'Kettle         ',0
n5:     db      'Small plant    ',0
n6:     db      'Desk lamp      ',0
n7:     db      'Postcard wall  ',0
m_got2: db      'got',0
m_tok:  db      ' tk',0

bought: dw      b0,b1,b2,b3,b4,b5,b6,b7,b8,b9
b8:     db      'A star chart. Signals heard before are marked + on the dial row.',0
b9:     db      'A second buffer: another packet can come in while one waits.',0
b0:     db      'Fine tuner fitted. Close enough is now on the nose.',0
b1:     db      'Bit hints on. Wrong bits show as ! now.',0
b2:     db      'A good heater. PIXEL has inspected it. It passes.',0
b3:     db      'Big buffer installed. Packets fill twice as fast.',0
b4:     db      'A kettle! Tea is now a station system.',0
b5:     db      'A small plant. PIXEL has already sniffed it twice.',0
b6:     db      'A desk lamp. The station feels warmer already.',0
b7:     db      'A postcard wall. Pinned: a nebula, a beach, a cat.',0

decor:  dw      0,0,0,0, d4,d5,d6,d7
d4:     db      ' c[_]',0            ; (five each: PIXEL's spots put them back)
d5:     db      ' \|/ ',0
d6:     db      ' (*) ',0
d7:     db      ' wall:',0
m_shelf: db     'shelf:',0

m_shop: db      'The shop. 1-9 and 0 buy, S to close.',0
m_shut: db      'Shop closed. Back to the dial.',0
m_have: db      'You have that already. It is lovely.',0
m_poor: db      'Not enough tokens yet. The night is long.',0

fcb:    db      0,'SIGSEEK SAV'
        ds      24
savbuf: ds      128
upg:    db      0
upg2:   db      0               ; 1 the star chart, 2 the second buffer
shift:  db      1
saved:  db      0ffh
sitem:  db      0
sbuy:   db      0
