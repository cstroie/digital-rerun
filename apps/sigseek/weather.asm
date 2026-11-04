; weather.asm: the weather over the nebula, the last lantern at 1420.0
; MHz, and the end of the Archive. Included by sigseek.asm.
;
; Weather changes with the shift and every 90 s or so, and is named in
; the title bar:
;   a clear night     as it is
;   solar wind        more static on the band, noisier packets
;   meteor shower     many short, weak pings
;   a still night     less static, cleaner packets
;   THE NEBULA HUMS   rare: the band glows, signals come in strong, and
;                     the last lantern is on the air
;
; The last lantern: once fragment 19 ("Look for it at 1420") is in the
; Archive, a steady signal can come at exactly 1420.0 MHz: always on a
; humming night, now and then otherwise. Its packet is the Lantern
; people's own, worth 20 tokens more.
;
; The Archive's end: when the 32nd fragment is kept, you read them all
; to PIXEL, as fragment 31 asks. Once; 100 tokens, and the title bar
; calls you a Lantern Keeper from then on.

WX_CLEAR equ    0
WX_WIND equ     1
WX_METEOR equ   2
WX_STILL equ    3
WX_HUM  equ     4
WX_TIME equ     900             ; ticks between changes (90 s)
BCN_F   equ     14200           ; 1420.0 MHz
F_BEACON equ    1               ; flags: the beacon found once
F_KEEPER equ    2               ; the Archive read to the end
K_BEACON equ    3               ; a packet's kind, after K_MSG K_CALL K_FRAG
FRAG19  equ     18              ; fragment 19, counted from 0

; ---------------------------------------------------------------- weather
; wxtick: every tick; a new weather when its time is up
wxtick: ld      hl,(wxtime)
        dec     hl
        ld      (wxtime),hl
        ld      a,h
        or      l
        ret     nz
; wxnew: pick the weather: clear 3/8, wind 2/8, meteor 1/8, still 3/16,
; hum 1/16
wxnew:  ld      hl,WX_TIME
        ld      (wxtime),hl
        call    rnd
        and     15
        ld      b,WX_CLEAR
        cp      6
        jr      c,wx1
        ld      b,WX_WIND
        cp      10
        jr      c,wx1
        ld      b,WX_METEOR
        cp      12
        jr      c,wx1
        ld      b,WX_STILL
        cp      15
        jr      c,wx1
        ld      b,WX_HUM
wx1:    ld      a,(wx)
        cp      b
        jr      z,wx3           ; the same: nothing to say
        ld      a,b
        ld      (wx),a
        call    wxset
        call    showwx
        ld      a,(wx)
        ld      hl,wxlogs
        call    msgof
        call    logmsg
wx3:    ld      a,(wx)          ; the last lantern?
        cp      WX_HUM
        jp      z,bcn
        call    rnd
        and     7
        ret     nz
        jp      bcn

; wxset: what the weather does to the band's static: wmask (and), wadd
wxset:  ld      a,(wx)
        ld      bc,0300h        ; mask 3, add 0
        cp      WX_STILL
        jr      nz,ws1
        ld      b,1
ws1:    cp      WX_WIND
        jr      nz,ws2
        ld      c,1
ws2:    cp      WX_HUM
        jr      nz,ws3
        ld      c,1
ws3:    ld      a,b
        ld      (wmask),a
        ld      a,c
        ld      (wadd),a
        ret

; showwx: the weather's name in the title bar (reversed)
showwx: ld      b,1
        ld      c,21
        call    gotoxy
        call    revon
        ld      a,(wx)
        ld      hl,wxnames
        call    msgof
        ld      c,26
        call    padput
        jp      revoff

; wxnoise: B = a packet's noisy bytes; the weather's say in it
wxnoise: ld     a,(wx)
        cp      WX_WIND
        jr      nz,wn1
        inc     b
wn1:    cp      WX_STILL
        ret     nz
        dec     b
        ret

; wxsig: IX = a new signal; the weather's say in it
wxsig:  ld      a,(wx)
        cp      WX_HUM
        jr      nz,wg1
        ld      a,(ix+S_STR)    ; humming: stronger
        cp      6
        ret     nc
        inc     (ix+S_STR)
        ret
wg1:    cp      WX_METEOR
        ret     nz
        call    rnd             ; meteors: weak and short (8-20 s)
        and     1
        add     a,3
        ld      (ix+S_STR),a
        call    rnd
        and     127
        add     a,80
        ld      (ix+S_LIFE),a
        ld      (ix+S_LIFE+1),0
        ret

; ---------------------------------------------------------------- the lantern
; bcn: the last lantern on the air, if fragment 19 is kept and it is not
; on already
bcn:    ld      a,FRAG19
        call    archas
        ret     z
        ld      ix,sigs         ; on already?
        ld      b,NSIG
        ld      de,S_SIZE
bc1:    ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,bc2
        ld      a,(ix+S_BCN)
        or      a
        ret     nz
bc2:    add     ix,de
        djnz    bc1
        ld      ix,sigs         ; a free slot
        ld      b,NSIG
bc3:    ld      a,(ix+S_LIFE)
        or      (ix+S_LIFE+1)
        jr      z,bc4
        add     ix,de
        djnz    bc3
        ret                     ; the band is full: another time
bc4:    ld      hl,BCN_F
        ld      (ix+S_FRQ),l
        ld      (ix+S_FRQ+1),h
        ld      hl,900          ; 90 s, still as a lamp
        ld      (ix+S_LIFE),l
        ld      (ix+S_LIFE+1),h
        ld      (ix+S_STR),6
        ld      (ix+S_DRF),0
        ld      (ix+S_BCN),1
        ld      hl,m_bcn
        jp      logmsg

; bstory: the beacon's packet delivered: its words, in the packet box
bstory: ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_bhead
        call    puts
        xor     a
        call    setattr
        ld      a,(flags)
        and     F_BEACON
        ld      hl,m_bfirst
        jr      z,bs1
        ld      hl,m_bagain
bs1:    ld      b,PK_Y+2
        call    putrow
        call    skipz
        ld      b,PK_Y+3
        call    putrow
        ld      hl,flags
        set     0,(hl)          ; F_BEACON
        ret

; ---------------------------------------------------------------- the end
; ending: when the Archive is whole, once. A scene in the packet box, a
; line every two seconds; then any key.
ending: ld      a,(flags)
        and     F_KEEPER
        ret     nz
        ld      c,0             ; all 32?
        ld      b,NFRAG
en1:    ld      a,b
        dec     a
        call    archas
        jr      z,en2
        inc     c
en2:    djnz    en1
        ld      a,c
        cp      NFRAG
        ret     nz
        ld      hl,flags
        set     1,(hl)          ; F_KEEPER
        ld      hl,(tokens)
        ld      de,100
        add     hl,de
        ld      (tokens),hl
        call    showtk
        call    showkp
        ld      a,WX_HUM        ; and the nebula hums
        ld      (wx),a
        call    wxset
        call    showwx
        call    save
        ld      a,5
        ld      (mode),a
        xor     a
        ld      (eline),a
        ld      a,1
        ld      (etick),a
        jp      clrbox

; scene: every tick while the scene plays: the next line, every 20 ticks
scene:  ld      a,(mode)
        cp      5
        ret     nz
        ld      hl,etick
        dec     (hl)
        ret     nz
        ld      (hl),20
        ld      a,(eline)
        cp      NEND
        ret     nc
        inc     a
        ld      (eline),a
        dec     a
        push    af
        add     a,PK_Y
        ld      b,a
        ld      c,3
        call    gotoxy
        pop     af
        push    af
        cp      NEND-1          ; the last line: bold
        ld      a,0
        jr      nz,sc1
        ld      a,A_BOLD
sc1:    call    setattr
        pop     af
        ld      hl,endlns
        call    msgof
        call    puts
        xor     a
        call    setattr
        ld      a,(eline)       ; PIXEL, as the lines go: listening, asleep
        cp      2
        jr      nz,sc2
        ld      a,MD_CURI       ; listening
        ld      (cmood),a
        call    showmd
        ld      hl,p_curi
        jp      drawp
sc2:    cp      NEND
        ret     nz
        ld      a,BEL
        call    putc
        ld      a,MD_SLEEP      ; and asleep
        ld      (cmood),a
        call    showmd
        ld      hl,p_sleep
        jp      drawp

; ekey: the scene's keys: once it has all been said, any key goes on
ekey:   ld      a,(eline)
        cp      NEND
        jp      c,nokey
        xor     a
        ld      (mode),a
        call    drawpk
        call    pose
        ld      hl,m_keeper
        call    logmsg
        jp      nokey

; showkp: the title bar's mark for a Lantern Keeper
showkp: ld      a,(flags)
        and     F_KEEPER
        ret     z
        ld      b,1
        ld      c,1
        call    gotoxy
        call    revon
        ld      a,'*'
        call    putc
        jp      revoff

; ---------------------------------------------------------------- data
wxnames: dw     w0, w1, w2, w3, w4
w0:     db      'a clear night',0
w1:     db      'solar wind',0
w2:     db      'meteor shower',0
w3:     db      'a still night',0
w4:     db      'THE NEBULA HUMS',0
wxlogs: dw      l0, l1, l2, l3, l4
l0:     db      'The sky clears. A good night for listening.',0
l1:     db      'Solar wind. The static rises; packets come in noisier.',0
l2:     db      'A meteor shower: quick little pings all over the band.',0
l3:     db      'A still night. The band is calm and the packets clean.',0
l4:     db      'THE NEBULA HUMS. The whole band glows, softly, everywhere.',0

m_bcn:  db      'A steady light at 1420.0 MHz. PIXEL',27h,'s ears go straight up.',0
m_bshort: db    '~ the last lantern ~',0
m_bhead: db     'FROM THE LAST LANTERN, 1420.0 MHz',0
m_bfirst: db    'You found us. We are the last lantern, kept lit at 1420.',0
        db      'Not lost: only far, and talking softly. Thank you, Kettle-7.',0
m_bagain: db    'The last lantern still burns. It burns brighter when you',0
        db      'listen. Goodnight, Kettle-7. Leave your light on, too.',0

NEND    equ     5
endlns: dw      e1, e2, e3, e4, e5
e1:     db      'The Archive is whole: all thirty-two lines. You read them',0
e2:     db      'aloud to PIXEL, as the last one asks. She listens to every',0
e3:     db      'one, ears forward. At the end the whole band hums, softly.',0
e4:     db      'PIXEL falls asleep. The Lantern people would have liked her.',0
e5:     db      '+100 tokens. You are a Lantern Keeper now.  (any key)',0
m_keeper: db    'A Lantern Keeper keeps the light. The night goes on, gently.',0

wx:     db      0ffh            ; (none yet: the first is always told)
wxtime: dw      1
wmask:  db      3
wadd:   db      0
flags:  db      0
eline:  db      0
etick:  db      0
