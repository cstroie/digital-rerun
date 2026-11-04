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
        sub     '1'
        jp      c,nokey
        cp      8
        jp      nc,nokey
        ld      (sitem),a
        call    mask            ; C = the item's bit
        ld      c,a
        ld      a,(upg)
        and     c
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
        ld      a,(upg)
        or      c
        ld      (upg),a
        ld      a,BEL
        call    putc
        call    showtk
        call    shelf
        call    pose            ; (a new heater shows at once)
        call    drawsh
        call    save
        ld      a,(sitem)
        ld      hl,bought
        call    msgof
sklog:  call    logmsg
        jp      nokey
skout:  xor     a
        ld      (mode),a
        call    drawpk
        ld      hl,m_shut
        jr      sklog

; drawsh: two columns of four, in the packet box
drawsh: ld      b,7
ds0:    ld      c,2
        call    gotoxy
        ld      d,SPEC_W
ds1:    ld      a,' '
        call    putc
        dec     d
        jr      nz,ds1
        inc     b
        ld      a,b
        cp      11
        jr      nz,ds0
        xor     a
ds2:    ld      (sitem),a
        ld      b,a             ; row 7 + i mod 4, column 4 or 35
        and     3
        add     a,7
        ld      c,4
        bit     2,b
        ld      b,a
        jr      z,ds3
        ld      c,35
ds3:    call    gotoxy
        ld      a,(sitem)
        add     a,'1'
        call    putc
        ld      a,' '
        call    putc
        ld      a,(sitem)
        ld      hl,names
        call    msgof
        call    puts
        ld      a,(sitem)       ; the price, or got
        call    mask
        ld      c,a
        ld      a,(upg)
        and     c
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
        cp      8
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
shelf:  ld      b,17
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
        ld      a,(sitem)
        ld      hl,decor
        call    msgof
        call    puts
sh2:    ld      a,(sitem)
        inc     a
        cp      8
        jr      nz,sh1
        ret

; ---------------------------------------------------------------- the save file
; SIGSEEK.SAV, one record: 'SG', version, terminal, seed, tokens,
; upgrades, packets, shift, PIXEL's mood.
SV_VER  equ     2               ; 1 was before the callers and the Archive

; load: at start. A new shift begins: shift + 1.
load:   call    fcbclr
        ld      de,savbuf
        ld      c,26            ; set DMA
        call    BDOS
        ld      de,fcb
        ld      c,15            ; open
        call    BDOS
        inc     a
        jr      z,ld9
        ld      de,fcb
        ld      c,20            ; read sequential
        call    BDOS
        push    af
        ld      de,fcb
        ld      c,16            ; close
        call    BDOS
        pop     af
        or      a
        jr      nz,ld9
        ld      hl,(savbuf)
        ld      de,'G'*256+'S'
        or      a
        sbc     hl,de
        jr      nz,ld9
        ld      a,(savbuf+2)
        cp      1
        jr      z,ld8           ; version 1: no story yet
        cp      SV_VER
        jr      nz,ld9
        ld      hl,savbuf+12    ; the callers' chapters, the Archive
        ld      de,chap
        ld      bc,NCALL+NFRAG/8
        ldir
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
prices: db      60, 120, 75, 105, 45, 30, 60, 90
names:  dw      n0,n1,n2,n3,n4,n5,n6,n7
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

bought: dw      b0,b1,b2,b3,b4,b5,b6,b7
b0:     db      'Fine tuner fitted. Close enough is now on the nose.',0
b1:     db      'Bit hints on. Wrong bits show as ! now.',0
b2:     db      'A good heater. PIXEL has inspected it. It passes.',0
b3:     db      'Big buffer installed. Packets fill twice as fast.',0
b4:     db      'A kettle! Tea is now a station system.',0
b5:     db      'A small plant. PIXEL has already sniffed it twice.',0
b6:     db      'A desk lamp. The station feels warmer already.',0
b7:     db      'A postcard wall. Pinned: a nebula, a beach, a cat.',0

decor:  dw      0,0,0,0, d4,d5,d6,d7
d4:     db      ' c[_]',0
d5:     db      '  \|/',0
d6:     db      '  (*)',0
d7:     db      '  [~][#][@]',0
m_shelf: db     'shelf:',0

m_shop: db      'The shop. 1-8 buy, S to close.',0
m_shut: db      'Shop closed. Back to the dial.',0
m_have: db      'You have that already. It is lovely.',0
m_poor: db      'Not enough tokens yet. The night is long.',0

fcb:    db      0,'SIGSEEK SAV'
        ds      24
savbuf: ds      128
upg:    db      0
shift:  db      1
saved:  db      0ffh
sitem:  db      0
