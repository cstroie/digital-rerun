; route.asm: the relay routing puzzle. Included by sigseek.asm.
;
; A caller's packet, once clean, still has to reach them: a grid of
; 6 x 3 relays in the packet box, each a straight or a corner, turned at
; random. Turn them (space or R) until the line runs from the antenna on
; the left to the caller on the right. The tiles lit from the antenna
; show how far it gets. Arrows (or , . and ^E ^X) move between tiles,
; C or ESC put the packet aside (it waits, clean, still to route).
;
; A tile is its arms: N 1, E 2, S 4, W 8. There is always a way: the
; grid is made from a path, then every tile is turned.

RT_W    equ     6
RT_H    equ     3
RT_N    equ     RT_W*RT_H
A_N     equ     1
A_E     equ     2
A_S     equ     4
A_W     equ     8
GX      equ     18              ; the grid's first column on screen
GY      equ     PK_Y+1          ; and row

; ---------------------------------------------------------------- a new grid
newrt:  call    rnd             ; where it comes in, where it goes out
        call    mod3
        ld      (rtsrc),a
        call    rnd
        call    mod3
        ld      (rtdst),a
        ld      hl,grid         ; every tile at random first
        ld      b,RT_N
nr0:    push    hl
        call    rnd
        and     1
        ld      a,A_W+A_E       ; a straight
        jr      z,nr1
        ld      a,A_N+A_E       ; a corner
nr1:    pop     hl
        ld      (hl),a
        inc     hl
        djnz    nr0
; then the path, column by column: down or up to a row, then east
        ld      a,(rtsrc)
        ld      (rtr),a
        ld      c,0             ; C = column
nr2:    ld      a,c
        cp      RT_W-1
        ld      a,(rtdst)
        jr      z,nr3
        call    rnd
        call    mod3
nr3:    ld      (rtt),a         ; the row it leaves this column by
        ld      a,(rtr)
        ld      b,a
        ld      a,(rtt)
        cp      b
        jr      nz,nr4
        ld      a,A_W+A_E       ; straight across
        call    setcell
        jr      nr8
nr4:    jr      c,nr6
; down: W+S here, N+S on the way, N+E at the bottom
        ld      a,A_W+A_S
        call    setcell
nr5:    inc     b
        ld      a,(rtt)
        cp      b
        ld      a,A_N+A_E
        jr      z,nr7
        ld      a,A_N+A_S
        call    setcell
        jr      nr5
; up: W+N here, N+S on the way, S+E at the top
nr6:    ld      a,A_W+A_N
        call    setcell
nr6a:   dec     b
        ld      a,(rtt)
        cp      b
        ld      a,A_S+A_E
        jr      z,nr7
        ld      a,A_N+A_S
        call    setcell
        jr      nr6a
nr7:    call    setcell
nr8:    ld      a,(rtt)
        ld      (rtr),a
        inc     c
        ld      a,c
        cp      RT_W
        jr      nz,nr2
; turn every tile 0-3 times, and make sure it is not solved already
        ld      hl,grid
        ld      b,RT_N
nr9:    push    bc
        call    rnd
        and     3
        jr      z,nr11
        ld      b,a
nr10:   ld      a,(hl)
        call    rotate
        ld      (hl),a
        djnz    nr10
nr11:   inc     hl
        pop     bc
        djnz    nr9
        call    trace
        jr      nz,nr12
        ld      a,(rtsrc)       ; solved by chance: turn the first tile
        ld      b,a
        ld      c,0
        call    cellp
        ld      a,(hl)
        call    rotate
        ld      (hl),a
nr12:   ld      a,1
        ld      (rtmade),a
        xor     a
        ld      (rtcur),a
        ld      (rtcur+1),a
        ret

; setcell: tile (row B, column C) = A
setcell: push   af
        call    cellp
        pop     af
        ld      (hl),a
        ret

; cellp: HL = the tile at row B, column C
cellp:  push    de
        ld      a,b
        add     a,a             ; row * 6
        add     a,b
        add     a,a
        add     a,c
        ld      e,a
        ld      d,0
        ld      hl,grid
        add     hl,de
        pop     de
        ret

; rotate: A's arms a quarter turn clockwise (N to E to S to W)
rotate: add     a,a
        bit     4,a
        jr      z,ro1
        or      1
ro1:    and     15
        ret

; mod3: A = A mod 3
mod3:   sub     3
        jr      nc,mod3
        add     a,3
        ret

; ---------------------------------------------------------------- tracing
; trace: follow the line from the antenna. Marks lit[] with the tiles it
; reaches; Z if it leaves on the right, by the caller's row.
trace:  ld      hl,lit
        ld      b,RT_N
tr0:    ld      (hl),0
        inc     hl
        djnz    tr0
        ld      a,(rtsrc)
        ld      b,a             ; B = row, C = column, D = the arm it comes in by
        ld      c,0
        ld      d,A_W
        ld      e,RT_N*2        ; no more steps than this (a loop of corners)
tr1:    call    cellp
        ld      a,(hl)
        and     d
        jr      z,trno
        push    de              ; lit
        ld      de,lit-grid
        add     hl,de
        ld      (hl),1
        pop     de
        call    cellp
        ld      a,(hl)
        xor     d               ; the other arm: where it goes
        cp      A_E
        jr      z,tre
        cp      A_W
        jr      z,trw
        cp      A_S
        jr      z,trs
; north
        ld      d,A_S
        ld      a,b
        or      a
        jr      z,trno
        dec     b
        jr      tr2
trs:    ld      d,A_N
        inc     b
        ld      a,b
        cp      RT_H
        jr      z,trno
        jr      tr2
trw:    ld      d,A_E
        ld      a,c
        or      a
        jr      z,trno
        dec     c
        jr      tr2
tre:    ld      d,A_W
        inc     c
        ld      a,c
        cp      RT_W
        jr      z,trout
tr2:    dec     e
        jr      nz,tr1
trno:   or      1               ; NZ: it does not get there
        ret
trout:  ld      a,(rtdst)       ; off the right edge: by the caller?
        cp      b
        ret

; ---------------------------------------------------------------- the keys
route0: call    newrt           ; a clean caller's packet: a new grid
route1: ld      a,4             ; (C again: back to the grid it has)
        ld      (mode),a
        call    drawrt
        ld      hl,m_rt
        call    logmsg
        jp      nokey

rkey:   cp      'C'
        jr      z,rkout
        cp      ESC
        jr      z,rkout
        ld      hl,rtcur+1      ; column
        cp      ','
        jr      z,rkl
        cp      19
        jr      z,rkl
        cp      '.'
        jr      z,rkr
        cp      4
        jr      z,rkr
        dec     hl              ; row
        cp      5
        jr      z,rkl
        cp      24
        jr      z,rkdn
        cp      ' '
        jr      z,rkturn
        cp      'R'
        jr      z,rkturn
        jp      nokey
rkl:    ld      a,(hl)          ; left, or up
        or      a
        jr      z,rkdraw
        dec     (hl)
        jr      rkdraw
rkr:    ld      a,(hl)          ; right
        cp      RT_W-1
        jr      z,rkdraw
        inc     (hl)
        jr      rkdraw
rkdn:   ld      a,(hl)          ; down
        cp      RT_H-1
        jr      z,rkdraw
        inc     (hl)
        jr      rkdraw
rkturn: ld      a,(rtcur)
        ld      b,a
        ld      a,(rtcur+1)
        ld      c,a
        call    cellp
        ld      a,(hl)
        call    rotate
        ld      (hl),a
        call    trace
        jr      nz,rkdraw
        call    drawrt          ; through: the whole line lit, then away
        ld      a,BEL
        call    putc
        ld      hl,m_rtok
        call    logmsg
        ld      a,ST_ROUTE
        call    stampit
        jp      deliv
rkdraw: call    drawrt
        jp      nokey
rkout:  xor     a
        ld      (mode),a
        call    drawpk
        ld      hl,m_aside
        call    logmsg
        jp      nokey

; ---------------------------------------------------------------- drawing
drawrt: call    clrbox
        call    trace           ; (for lit[])
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      hl,m_rtto
        call    puts
        call    pkname
        ld      a,(rtsrc)       ; the antenna, in on the left
        add     a,GY
        ld      b,a
        ld      c,GX-7
        call    gotoxy
        ld      hl,m_rtant
        call    puts
        ld      a,(rtdst)       ; the caller, out on the right
        add     a,GY
        ld      b,a
        ld      c,GX+RT_W*5
        call    gotoxy
        ld      hl,m_rtout
        call    puts
        call    pkname
        ld      b,0             ; the tiles
dt1:    ld      a,b
        add     a,GY
        push    bc
        ld      b,a
        ld      c,GX
        call    gotoxy
        pop     bc
        ld      c,0
dt2:    call    tile
        inc     c
        ld      a,c
        cp      RT_W
        jr      nz,dt2
        inc     b
        ld      a,b
        cp      RT_H
        jr      nz,dt1
        ret

; pkname: the caller's name, up to its first comma
pkname: ld      a,(pkwho)
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        ld      l,a
        ld      h,0
        ld      de,X_CALL
        add     hl,de
        call    str
pn1:    ld      a,(hl)
        or      a
        ret     z
        cp      ','
        ret     z
        call    putc
        inc     hl
        jr      pn1

; tile: draw tile (B, C), five characters. Lit arms are = and #, the
; selected tile has : for its blanks (and reverse video where there is).
tile:   push    bc
        call    cellp
        ld      a,(hl)
        ld      (tmask),a
        ld      de,lit-grid
        add     hl,de
        ld      a,(hl)
        or      a
        ld      a,'-'
        ld      e,'|'
        jr      z,ti1
        ld      a,'='
        ld      e,'#'
ti1:    ld      (th),a
        ld      a,e
        ld      (tv),a
        ld      a,' '           ; selected?
        ld      (tsp),a
        xor     a
        ld      (tsel),a
        ld      a,(rtcur)
        cp      b
        jr      nz,ti2
        ld      a,(rtcur+1)
        cp      c
        jr      nz,ti2
        ld      a,':'
        ld      (tsp),a
        ld      a,1
        ld      (tsel),a
        call    revon
ti2:    ld      a,(tmask)       ; which of the six shapes
        ld      hl,shapes
        ld      b,6
ti3:    cp      (hl)
        jr      z,ti4
        inc     hl
        inc     hl
        inc     hl
        inc     hl
        inc     hl
        inc     hl
        djnz    ti3
ti4:    inc     hl
        ld      b,5
ti5:    ld      a,(hl)          ; h, v, s: the arm and blank characters
        cp      'h'
        jr      nz,ti6
        ld      a,(th)
ti6:    cp      'v'
        jr      nz,ti7
        ld      a,(tv)
ti7:    cp      ' '
        jr      nz,ti8
        ld      a,(tsp)
ti8:    call    putc
        inc     hl
        djnz    ti5
        ld      a,(tsel)
        or      a
        call    nz,revoff
        pop     bc
        ret

; the shapes: arms, then five characters (h a horizontal arm, v vertical)
shapes: db      A_W+A_E, 'hhhhh'
        db      A_N+A_S, '  v  '
        db      A_N+A_E, '  ',27h,'hh'
        db      A_E+A_S, '  .hh'
        db      A_S+A_W, 'hh.  '
        db      A_W+A_N, 'hh',27h,'  '

m_rt:   db      'Clean! Now route it: SPACE turns a relay, arrows move.',0
m_rtok: db      'Routed. The line runs clear through the relays.',0
m_rtto: db      'Route the packet to ',0
m_rtant: db     'ANT >--',0
m_rtout: db     '-> ',0

grid:   ds      RT_N
lit:    ds      RT_N
rtsrc:  db      0
rtdst:  db      0
rtr:    db      0
rtt:    db      0
rtcur:  db      0,0             ; row, column
tmask:  db      0
th:     db      0
tv:     db      0
tsp:    db      0
tsel:   db      0
