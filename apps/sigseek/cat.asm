; cat.asm: PIXEL, the station cat. Included by sigseek.asm.
;
; She is not managed. Every 8-20 s she makes up her mind: a new mood,
; and maybe a walk to one of her spots. Out of her box she is a small
; sprite =^.^= that walks along row 14 and sits where she likes:
;
;   heater   home, in the box; purring lowers the static
;   antenna  on the top border; her ears point at signals
;   keyboard below the help line; she presses keys, the dial moves
;   console  on the spectrogram, in the way
;   mug      on the log's bottom border; the mug does not survive
;
; While the operator is away her doings go into the diary, and she
; sometimes brings gifts.

SP_HOME equ     0
SP_ANT  equ     1
SP_KEY  equ     2
SP_CON  equ     3
SP_MUG  equ     4

MD_SLEEP equ    0
MD_CURI equ     1
MD_SMUG equ     2
MD_NEEDY equ    3
MD_ZOOM equ     4
MD_HUFF equ     5

WALK_Y  equ     22
HOME_X  equ     70              ; where she steps out of the box

; ---------------------------------------------------------------- each tick
cat:    ld      a,(cwalk)
        or      a
        jp      nz,walk
        ld      a,(cspot)       ; on the console: drawn over the band
        cp      SP_CON
        call    z,drawsp
        ld      hl,(ctimer)
        dec     hl
        ld      (ctimer),hl
        ld      a,h
        or      l
        ret     nz
; time to decide
        call    rnd             ; next decision in 80..207 ticks
        and     127
        add     a,80
        ld      l,a
        ld      h,0
        ld      (ctimer),hl
        call    rnd             ; a new mood, half the time
        ld      b,a
        and     1
        jr      z,cd2
        ld      a,b
        rrca
        and     7
        cp      6
        jr      c,cd1
        xor     a               ; 6, 7: sleepy (she sleeps a lot)
cd1:    ld      (cmood),a
cd2:    call    rnd
        ld      b,a
        ld      a,(cspot)
        or      a
        jr      nz,cd5
; at home: curious and zoomy cats go out; others mostly stay
        ld      a,(cmood)
        cp      MD_CURI
        jr      z,cd3
        cp      MD_ZOOM
        jr      z,cd3
        ld      a,b
        and     3
        jr      nz,cd4
cd3:    ld      a,b             ; a spot 1..4
        rrca
        rrca
        and     3
        inc     a
        jp      goto
cd4:    call    gift            ; while you are away, maybe a gift
        jp      pose
; out: sleepy cats go home; the rest may wander on
cd5:    ld      a,(cmood)
        or      a
        ld      a,SP_HOME
        jp      z,goto
        ld      a,b
        and     3
        ret     nz
        ld      a,b
        rrca
        rrca
        and     3
        inc     a
        jp      goto

; ---------------------------------------------------------------- walking
; goto: A = spot. Leave the current spot, then walk along row 14.
goto:   ld      hl,cspot
        cp      (hl)
        ret     z
        ld      (cdest),a
        call    lvspot
        ld      a,(cdest)
        call    spotxy          ; C = target column
        ld      a,(cdest)
        or      a
        jr      nz,go1
        ld      c,HOME_X
go1:    ld      a,c
        ld      (ctx),a
        ld      a,1
        ld      (cwalk),a
        ld      a,0ffh
        ld      (cspot),a       ; nowhere: on her way
        ld      hl,ml_wand
        call    label
        ld      hl,p_empty
        call    drawp
        ld      a,(cdest)
        ld      hl,goingto
        call    msgof
        jp      logmsg

; one column a tick
walk:   ld      b,WALK_Y
        ld      a,(cx)
        ld      c,a
        call    gotoxy
        ld      hl,s_blank
        call    puts
        ld      a,(ctx)
        ld      hl,cx
        cp      (hl)
        jr      z,arrive
        jr      c,wk1
        inc     (hl)
        jr      wk2
wk1:    dec     (hl)
wk2:    ld      a,(hl)
        ld      c,a
        call    gotoxy
        ld      hl,s_cat
        jp      puts

arrive: xor     a
        ld      (cwalk),a
        ld      a,(cdest)
        ld      (cspot),a
        ld      hl,spotlbl
        call    msgof
        call    label
        call    pose
        ld      a,(cspot)
        or      a
        jr      z,ar1
        call    drawsp
ar1:    ld      a,(cspot)
        cp      SP_ANT
        jp      z,ears
        cp      SP_KEY
        jp      z,keys
        ld      hl,arrmsg
        call    msgof
        jp      logmsg

; the antenna: she hears what you do not
ears:   ld      c,0             ; bit 0: one below the dial, bit 1: above
        ld      ix,sigs
        ld      b,NSIG
eb1:    ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,eb3
        ld      l,(ix+S_FRQ)
        ld      h,(ix+S_FRQ+1)
        ld      de,(freq)
        or      a
        sbc     hl,de
        ld      a,1
        bit     7,h
        jr      nz,eb2
        ld      a,h
        or      l
        jr      z,eb3           ; dead on: nothing to point at
        ld      a,2
eb2:    or      c
        ld      c,a
eb3:    ld      de,S_SIZE
        add     ix,de
        djnz    eb1
        ld      a,c
        ld      hl,ml_quiet
        or      a
        jr      z,ea1
        ld      hl,ml_earl
        cp      1
        jr      z,ea1
        ld      hl,ml_earr
        cp      2
        jr      z,ea1
        ld      hl,ml_earb
ea1:    jp      logmsg

; the keyboard: the dial jumps somewhere
keys:   call    rnd
        and     63
        sub     32
        ld      e,a
        add     a,a
        sbc     a,a
        ld      d,a
        ld      hl,(freq)
        add     hl,de
        ld      (freq),hl
        call    showfq
        ld      hl,ml_keys
        jp      logmsg

; leave the spot she is on: put back what she covered
lvspot: ld      a,(cspot)
        or      a
        jr      z,lv1
        cp      0ffh
        ret     z
        push    af
        call    spotxy
        call    gotoxy
        pop     af
        ld      hl,restore
        call    msgof
        call    puts
lv1:    ld      a,HOME_X        ; she starts her walk below the box,
        ld      (cx),a          ; or below the spot she was on
        ld      a,(cspot)
        or      a
        ret     z
        call    spotxy
        ld      a,c
        ld      (cx),a
        ret

; drawsp: the sprite on her spot
drawsp: ld      a,(cspot)
        call    spotxy
        call    gotoxy
        ld      hl,s_cat
        jp      puts

; spotxy: A = spot -> B = row, C = column
spotxy: add     a,a
        ld      hl,spots
        add     a,l
        ld      l,a
        jr      nc,sx1
        inc     h
sx1:    ld      b,(hl)
        inc     hl
        ld      c,(hl)
        ret

; msgof: HL = table of words, A = index -> HL = the word
msgof:  add     a,a
        add     a,l
        ld      l,a
        jr      nc,mo1
        inc     h
mo1:    ld      a,(hl)
        inc     hl
        ld      h,(hl)
        ld      l,a
        ret

; ---------------------------------------------------------------- the box
; pose: her mood, drawn in the box when at home; the bed when not.
; While she sleeps at home she purrs, and the static is lower.
pose:   ld      a,3             ; purr is the noise mask: 3, or 1 purring
        ld      (purr),a
        ld      a,(cspot)
        or      a
        ld      hl,p_empty
        jr      z,po_h
        push    hl
        call    showhs
        pop     hl
        jr      drawp
po_h:
        ld      a,(upg)         ; the good heater: she always purrs
        and     U_HEAT
        jr      nz,po0
        ld      a,(cmood)
        or      a
        jr      nz,po1
po0:    ld      a,1
        ld      (purr),a
po1:    ld      b,PK_Y+4        ; her mood, under her name
        ld      c,68
        call    gotoxy
        ld      a,(cmood)
        ld      hl,moods
        call    msgof
        call    puts
        ld      a,(cmood)
        ld      hl,poses
        call    msgof
        push    hl
        call    showhs          ; the hiss in the deck: low when she purrs
        pop     hl
; drawp: HL = three rows of 12, into the box (rows 7-9, column 68)
drawp:  ld      b,PK_Y
dp1:    ld      c,68
        call    gotoxy
        ld      d,12
dp2:    ld      a,(hl)
        call    putc
        inc     hl
        dec     d
        jr      nz,dp2
        inc     b
        ld      a,b
        cp      PK_Y+3
        jr      nz,dp1
        ret

; label: HL = 12 characters for row 10 of the box
label:  push    hl
        ld      b,PK_Y+3
        ld      c,68
        call    gotoxy
        pop     hl
        jp      puts

; ---------------------------------------------------------------- [P]IXEL
pet:    call    pose            ; (wakes the box up if it was stale)
        ld      a,(cspot)
        or      a
        jr      z,pt1
        cp      0ffh
        jp      z,ptwalk
        ld      a,(cmood)       ; out: only a needy cat comes when called
        cp      MD_NEEDY
        ld      hl,ml_call
        jp      nz,ptlog
        ld      a,MD_SLEEP
        ld      (cmood),a
        ld      hl,ml_comes
        call    logmsg
        xor     a
        call    goto
        jp      nokey
pt1:    ld      a,(cmood)
        ld      hl,petmsg
        call    msgof
        call    logmsg
        ld      a,(cmood)       ; petting mends some moods
        cp      MD_HUFF
        ld      b,MD_SMUG
        jr      z,pt2
        cp      MD_NEEDY
        ld      b,MD_SLEEP
        jr      z,pt2
        jp      nokey
pt2:    ld      a,b
        ld      (cmood),a
        call    pose
        jp      nokey
ptwalk: ld      hl,ml_busy
ptlog:  call    logmsg
        jp      nokey

; gift: only while the operator is away, now and then
gift:   ld      a,(away)
        or      a
        ret     z
        call    rnd
        and     7
        ret     nz
        call    rnd
        and     3
        ld      hl,gifts
        call    msgof
        jp      logmsg

; ---------------------------------------------------------------- the diary
; While away, each log line goes in the diary (the last three, with
; the time). On return, they are shown in the packet box.
NDIA    equ     4
diary:  ld      a,(away)
        or      a
        ret     z
        push    hl
        ld      de,dia          ; shift the older ones up
        ld      hl,dia+4
        ld      bc,NDIA*4-4
        ldir
        pop     hl
        ld      a,(hours)       ; and the new one at the end
        ld      (de),a
        inc     de
        ld      a,(mins)
        ld      (de),a
        inc     de
        ld      a,l
        ld      (de),a
        inc     de
        ld      a,h
        ld      (de),a
        ld      a,(ndia)
        cp      NDIA
        ret     nc
        inc     a
        ld      (ndia),a
        ret

showdia: ld     b,PK_Y
        ld      c,3
        call    gotoxy
        ld      hl,m_while
        call    puts
        ld      a,(missed)      ; and how many signals came and went
        or      a
        jr      z,dyn
        push    af
        ld      hl,m_miss1
        call    puts
        pop     af
        call    decn
        ld      hl,m_miss2
        call    puts
dyn:    ld      a,(ndia)
        or      a
        ret     z
        ld      e,a             ; the last E entries of the diary
        ld      a,NDIA
        sub     e
        add     a,a
        add     a,a
        ld      hl,dia
        add     a,l
        ld      l,a
        jr      nc,dy0
        inc     h
dy0:    ld      b,PK_Y+1
dy1:    push    bc
        push    de
        ld      c,3
        call    gotoxy
        ld      d,61            ; clear the row
dy2:    ld      a,' '
        call    putc
        dec     d
        jr      nz,dy2
        call    gotoxy
        ld      a,(hl)
        call    dec2
        ld      a,':'
        call    putc
        inc     hl
        ld      a,(hl)
        call    dec2
        ld      a,' '
        call    putc
        inc     hl
        ld      e,(hl)
        inc     hl
        ld      d,(hl)
        inc     hl
        push    hl
        ex      de,hl
        ld      d,56            ; at most 56 characters: up to column 64
dy3:    ld      a,(hl)
        or      a
        jr      z,dy4
        call    putc
        inc     hl
        dec     d
        jr      nz,dy3
dy4:    pop     hl
        pop     de
        pop     bc
        inc     b
        dec     e
        jr      nz,dy1
        ret

; ---------------------------------------------------------------- data
; spots: row, column (the heater is the box)
spots:  db      0,0, 2,30, 23,61, 4,40, 21,46
; what she covers on each spot
restore: dw     0, r_dash, r_keys, s_blank, r_dash
r_keys: db      ':::::',0
r_dash: db      '-----',0
s_blank: db     '     ',0
s_cat:  db      '=^.^=',0

moods:  dw      md0, md1, md2, md3, md4, md5
md0:    db      '  (sleepy)  ',0
md1:    db      '  (curious) ',0
md2:    db      '  (smug)    ',0
md3:    db      '  (needy)   ',0
md4:    db      '  (zoomies) ',0
md5:    db      '  (huffy)   ',0
poses:  dw      p_sleep, p_curi, p_smug, p_needy, p_zoom, p_huff
p_sleep: db     '   /\_/\    '
        db      '  ( -.- ) zz'
        db      '   > ^ <    '
p_curi: db      '   /\_/\  ? '
        db      '  ( O.O )   '
        db      '   > ^ <    '
p_smug: db      '   /\_/\    '
        db      '  ( ^.^ )/  '
        db      '   > ^ <  ~ '
p_needy: db     '   /\_/\    '
        db      '  ( o.o )   '
        db      '  ...you?   '
p_zoom: db      '      /\_/\ '
        db      ' ~~~~ (>.<) '
        db      '  =3 =3     '
p_huff: db      '            '
        db      '   /\_/\__  '
        db      '  ( -_- )__)'
p_empty: db     '            '
        db      '            '
        db      '  ~~~~~~~~  '

spotlbl: dw     ml_heat, ml_ant, ml_key, ml_con, ml_mug
ml_heat: db     '  heater    ',0
ml_ant: db      '  antenna   ',0
ml_key: db      '  keyboard  ',0
ml_con: db      '  console   ',0
ml_mug: db      '  your mug  ',0
ml_wand: db     '  wandering ',0

goingto: dw     g_home, g_ant, g_key, g_con, g_mug
g_home: db      'PIXEL pads back toward the heater.',0
g_ant:  db      'PIXEL has business at the antenna hatch.',0
g_key:  db      'PIXEL is walking toward the keyboard. Uh oh.',0
g_con:  db      'PIXEL hops down from the box. She is going somewhere.',0
g_mug:  db      'PIXEL has noticed your mug.',0

arrmsg: dw      a_home, 0, 0, a_con, a_mug
a_home: db      'PIXEL is back on the heater. Purring lowers the static.',0
a_con:  db      'PIXEL lies on the console. She is helping.',0
a_mug:  db      'PIXEL knocked your mug off the console. The mug is fine.',0
ml_keys: db     'PIXEL walked across the keyboard. The dial moved. Thanks.',0
ml_quiet: db    'PIXEL listens at the antenna. All quiet, she says.',0
ml_earl: db     'PIXEL',27h,'s ears point left. She heard something.',0
ml_earr: db     'PIXEL',27h,'s ears point right. She heard something.',0
ml_earb: db     'PIXEL',27h,'s ears go left, right, left. Busy night.',0

petmsg: dw      e_sleep, e_curi, e_smug, e_needy, e_zoom, e_huff
e_sleep: db     'You pet PIXEL. She purrs without waking up.',0
e_curi: db      'PIXEL headbutts your hand, then looks at the dial.',0
e_smug: db      'You pet PIXEL. She permits this, for now.',0
e_needy: db     'PIXEL melts into your hand. That was the right amount.',0
e_zoom: db      'PIXEL is a blur. You pet the air where she was.',0
e_huff: db      'PIXEL turns her back. Then, slowly, forgives you.',0
ml_call: db     'You call PIXEL. She looks at you. She stays put.',0
ml_comes: db    'You call PIXEL. She comes trotting home at once.',0
ml_busy: db     'PIXEL is on her way somewhere. Important cat business.',0

gifts:  dw      f_screw, f_moth, f_chip, f_sock
f_screw: db     'PIXEL brought you a gift: one (1) screw, slightly chewed.',0
f_moth: db      'PIXEL brought you a moth. It is alive and grateful.',0
f_chip: db      'PIXEL brought you a chip. It says Z80 on it. Very proud.',0
f_sock: db      'PIXEL brought you a sock. Not yours. Not anyone',27h,'s.',0

m_while: db     'While you were away:',0
m_miss1: db     ' (',0
m_miss2: db     ' signals drifted by)',0

cspot:  db      SP_HOME
cmood:  db      MD_SLEEP
cwalk:  db      0
cdest:  db      0
cx:     db      HOME_X
ctx:    db      0
ctimer: dw      120
ndia:   db      0
dia:    ds      NDIA*4
