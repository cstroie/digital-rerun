; story.asm: SIGSEEK.DAT, the callers and the Archive. Included by
; sigseek.asm.
;
; SIGSEEK.DAT (made by mkdat.js from sigseek.txt) is read whole into
; memory after the program. Its strings, by number:
;   0..31                    messages from nobody in particular
;   32 + 16i                 caller i's name, then for chapter j:
;   32 + 16i + 1 + 3j        the packet text, the two letter lines
;   160 + 2k                 fragment k's packet text, then its line
;   224 + 5c                 postcard c: its caption, its four lines
;
; A packet is from a caller (half the time), an Archive fragment (a
; quarter) or nobody. Callers come into the story slowly: two at first,
; one more every four packets. Each delivery moves a caller's story on a
; chapter; after the last, they keep writing, in their later voice.

NMSG    equ     32
NCALL   equ     8
NCH     equ     5
NFRAG   equ     32
X_CALL  equ     NMSG
X_FRAG  equ     NMSG+NCALL*16

K_MSG   equ     0
K_CALL  equ     1
K_FRAG  equ     2

; ---------------------------------------------------------------- loading
; loaddat: read SIGSEEK.DAT; on failure say so and leave
loaddat: ld     hl,dfcb+12
        ld      b,24
la0:    ld      (hl),0
        inc     hl
        djnz    la0
        ld      de,dfcb
        ld      c,15
        call    BDOS
        inc     a
        jr      z,lafail
        ld      hl,datbuf
la1:    push    hl
        ex      de,hl
        ld      c,26            ; DMA: the next 128 bytes
        call    BDOS
        ld      de,dfcb
        ld      c,20
        call    BDOS
        pop     hl
        or      a
        jr      nz,la2          ; end of file
        ld      de,128
        add     hl,de
        ex      de,hl           ; room for the next record, below the BDOS?
        ld      hl,(6)
        dec     h
        dec     h
        or      a
        sbc     hl,de
        ex      de,hl
        jr      nc,la1
        jr      lafail
la2:    ld      hl,(datbuf)     ; 'SDAT', version 1, the counts we know
        ld      de,'D'*256+'S'
        or      a
        sbc     hl,de
        jr      nz,lafail
        ld      hl,(datbuf+2)
        ld      de,'T'*256+'A'
        sbc     hl,de
        jr      nz,lafail
        ld      hl,datbuf+4
        ld      de,dathdr
        ld      b,6
la3:    ld      a,(de)
        cp      (hl)
        jr      nz,lafail
        inc     hl
        inc     de
        djnz    la3
        ld      de,savbuf       ; the DMA back where the save file wants it
        ld      c,26
        jp      BDOS
lafail: ld      hl,m_nodat
        call    puts
        ld      sp,(oldsp)
        ret

dathdr: db      2, NMSG, NCALL, NCH, NFRAG, NCARD

; str: HL = a string's number -> HL = the string
str:    push    de
        add     hl,hl
        ld      de,datbuf+16
        add     hl,de
        ld      e,(hl)
        inc     hl
        ld      d,(hl)
        ld      hl,datbuf
        add     hl,de
        pop     de
        ret

; ---------------------------------------------------------------- choosing
; pick: what the new packet is. HL = its text.
pick:   ld      ix,(lockix)     ; who the locked signal carries
        ld      a,(ix+S_KIND)
        cp      K_BEACON        ; the last lantern: its own words
        jr      nz,pk0
        ld      (pkkind),a
        ld      hl,m_bshort
        ret
pk0:    cp      K_ECHO          ; an echo: the old message itself
        jr      nz,pk0e
        ld      (pkkind),a
        ld      hl,etext
        ret
pk0e:   cp      K_GHOST         ; a ghost: it looks like any message
        jr      nz,pk0a
        ld      (pkkind),a
        call    rnd
        and     NMSG-1
        ld      l,a
        ld      h,0
        jp      str
pk0a:   cp      K_FRAG
        jp      z,pkfr
        cp      K_CALL
        jr      z,pkcl
; nobody in particular
        xor     a
        ld      (pkkind),a
        ld      l,(ix+S_WHO)
        ld      h,0
        jp      str
; a caller
pkcl:   ld      (pkkind),a
        ld      a,(ix+S_WHO)
        ld      (pkwho),a
        ld      e,a
        ld      d,0
        ld      hl,chap
        add     hl,de
        ld      a,(hl)
        cp      NCH
        jr      c,pc3
        call    rnd             ; after the story: the later chapters again
        and     1
        add     a,NCH-2
pc3:    ld      (pkch),a
        ld      b,a             ; 16i + 1 + 3j
        add     a,a
        add     a,b
        inc     a
        ld      b,a
        ld      a,(pkwho)
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,b
        ld      l,a
        ld      h,0
        ld      de,X_CALL
        add     hl,de
        jp      str
; an Archive fragment, one not yet kept if there is one
pkfr:   ld      a,K_FRAG
        ld      (pkkind),a
        call    rnd
        and     NFRAG-1
        ld      c,a
        ld      b,NFRAG
pf1:    ld      a,c
        call    archas
        jr      z,pf2
        ld      a,c
        inc     a
        and     NFRAG-1
        ld      c,a
        djnz    pf1
pf2:    ld      a,c
        ld      (pkfrag),a
fragtx: ld      l,a             ; A = fragment -> HL = its packet text
        ld      h,0
        add     hl,hl
        ld      de,X_FRAG
        add     hl,de
        jp      str

; archas: is fragment A kept? NZ if so. HL = its byte, A = its mask.
archas: push    bc
        ld      c,a
        rrca
        rrca
        rrca
        and     3
        ld      hl,arch
        add     a,l
        ld      l,a
        jr      nc,ah1
        inc     h
ah1:    ld      a,c
        and     7
        call    mask
        ld      b,a
        and     (hl)
        ld      a,b             ; (ld and pop keep the flags)
        pop     bc
        ret

; ---------------------------------------------------------------- delivery
; story: after a delivery, the letter (or the fragment) in the packet box
story:  call    echkeep         ; (kept, to come back another night)
        ld      a,(pkkind)
        cp      K_ECHO
        jp      z,estory
        cp      K_BEACON
        jp      z,bstory
        cp      K_CALL
        jr      z,sycall
        cp      K_FRAG
        ret     nz
        call    tl_frag         ; tonight's tally
        ld      a,ST_FRAG
        call    stampit
        ld      a,(pkfrag)      ; a fragment for the Archive
        call    archas
        or      (hl)
        ld      (hl),a
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      hl,m_arch1
        call    puts
        ld      a,(pkfrag)
        inc     a
        call    dec2
        ld      hl,m_arch2
        call    puts
        ld      a,(pkfrag)
        call    fragtx
        call    skipz           ; past the packet text: the line
        ld      b,PK_Y+2
        call    putrow
        jp      ending          ; the 32nd? the Archive's end
sycall: call    tl_let          ; tonight's tally
        ld      a,ST_LETTER
        call    stampit
        ld      a,(pkwho)       ; the story moves on
        ld      e,a
        ld      d,0
        ld      hl,chap
        add     hl,de
        ld      a,(hl)
        cp      NCH
        jr      nc,sy1
        inc     (hl)
        ld      a,(hl)          ; the story's end: a postcard too
        cp      NCH
        ld      a,(pkwho)
        call    z,gotcard
sy1:    ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      hl,m_from2
        call    puts
        ld      a,(pkwho)       ; the name
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        ld      l,a
        ld      h,0
        ld      de,X_CALL
        add     hl,de
        call    str
        call    puts
        ld      hl,m_ch1
        call    puts
        ld      a,(pkch)
        inc     a
        call    decn
        ld      hl,m_ch2
        call    puts
        ld      a,(pkwho)       ; the chapter's text, then its two lines
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        ld      b,a
        ld      a,(pkch)
        ld      c,a
        add     a,a
        add     a,c
        inc     a
        add     a,b
        ld      l,a
        ld      h,0
        ld      de,X_CALL
        add     hl,de
        call    str
        call    skipz
        ld      b,PK_Y+1
        call    putrow
        call    skipz
        ld      b,PK_Y+2
        call    putrow
        call    psline          ; a P.S., if they had a reply
        call    all8            ; (every caller met?)
        call    opinion         ; and what PIXEL makes of them
        jp      askrep          ; and a reply to this one?
; putrow: HL = a string, on row B from column 3; HL left on its end
putrow: ld      c,3
        call    gotoxy
        jp      puts

; skipz: HL past the end of its string
skipz:  ld      a,(hl)
        inc     hl
        or      a
        jr      nz,skipz
        ret

; ---------------------------------------------------------------- the Archive
; A: the fragments kept so far, a star for each on a row of 32, and
; one of them to read. , . (or left, right) to turn, A or ESC to close.
archive: ld     a,3
        ld      (mode),a
        xor     a
        ld      (arsel),a
        call    arnext0
        call    drawar
        jp      nokey

akey:   cp      'K'             ; the stamp book, from here too
        jp      z,stpage
        cp      'L'             ; the Archive, on the printer
        jr      nz,ak0
        call    parch
        jp      nokey
ak0:
        cp      'A'
        jr      z,akout
        cp      ESC
        jr      z,akout
        cp      ','
        jr      z,akprev
        cp      19
        jr      z,akprev
        cp      '.'
        jr      z,aknext
        cp      4
        jr      z,aknext
        jp      nokey
aknext: call    arnext
        jr      akdraw
akprev: ld      b,NFRAG         ; the kept one before
akp1:   ld      a,(arsel)
        dec     a
        and     NFRAG-1
        ld      (arsel),a
        call    archas
        jr      nz,akdraw
        djnz    akp1
akdraw: call    drawar
        jp      nokey
akout:  xor     a
        ld      (mode),a
        call    drawpk
        jp      nokey

; arnext: the kept one after arsel; arnext0: arsel itself if kept
arnext0: ld     a,(arsel)
        call    archas
        ret     nz
arnext: ld      b,NFRAG
an1:    ld      a,(arsel)
        inc     a
        and     NFRAG-1
        ld      (arsel),a
        call    archas
        ret     nz
        djnz    an1
        ret

drawar: call    clrbox
        ld      b,PK_Y
        ld      c,3
        call    gotoxy
        ld      hl,m_artit
        call    puts
        ld      c,0             ; count the kept ones
        ld      b,NFRAG
dr1:    ld      a,b
        dec     a
        call    archas
        jr      z,dr2
        inc     c
dr2:    djnz    dr1
        ld      a,c
        ld      (arcnt),a
        cp      NFRAG           ; all of it: COMPLETE, and read, or not yet
        jr      nz,dra1
        ld      a,A_BOLD
        call    setattr
        ld      hl,m_arcomp
        call    puts
        xor     a
        call    setattr
        ld      a,(flags)
        and     F_KEEPER
        ld      hl,m_arread
        call    nz,puts
        jr      dra2
dra1:   call    decn
        ld      hl,m_arof
        call    puts
dra2:
        ld      b,PK_Y+1             ; the sky: * kept, . not yet, @ this one
        ld      c,3
        call    gotoxy
        ld      c,0
dr3:    ld      a,c
        call    archas
        ld      a,'.'
        jr      z,dr4
        ld      a,(arsel)
        cp      c
        ld      a,'*'
        jr      nz,dr4
        ld      a,'@'
dr4:    call    putc
        inc     c
        ld      a,c
        cp      NFRAG
        jr      nz,dr3
        ld      a,(arcnt)
        or      a
        ld      hl,m_arnone
        ld      b,PK_Y+2
        jp      z,putrow
        ld      b,PK_Y+2
        ld      c,3
        call    gotoxy
        ld      a,(arsel)
        inc     a
        call    dec2
        ld      a,' '
        call    putc
        call    putc
        ld      a,(arsel)
        call    fragtx
        call    skipz
        call    puts
        ld      hl,m_arkeys
        ld      b,PK_Y+3
        jp      putrow

; clrbox: the packet box, rows 7-10, blank
clrbox: ld      b,PK_Y
cb0:    ld      c,2
        call    gotoxy
        ld      d,SPEC_W
cb1:    ld      a,' '
        call    putc
        dec     d
        jr      nz,cb1
        inc     b
        ld      a,b
        cp      PK_Y+5
        jr      nz,cb0
        ret

; ---------------------------------------------------------------- data
m_nodat: db     CR,LF,'SIGSEEK.DAT is missing (or from another version).',CR,LF
        db      'It must be on the same drive as SIGSEEK.COM.',CR,LF,0
m_arch1: db     'For the Archive: fragment ',0
m_arch2: db     ' of 32. (A to read them all)',0
m_from2: db     'From ',0
m_ch1:  db      ' (',0
m_ch2:  db      '/5):',0
m_artit: db     'THE ARCHIVE OF THE LANTERN BEACONS: ',0
m_arof: db      ' of 32',0
m_arcomp: db    'COMPLETE',0
m_arread: db    '  (read to PIXEL)',0
m_arnone: db    'Empty, for now. Fragments come on signals with no sender.',0
m_arkeys: db    ',. turn the page   A close',0

dfcb:   db      0,'SIGSEEK DAT'
        ds      24
arsel:  db      0
arcnt:  db      0
chap:   ds      NCALL           ; each caller's next chapter
arch:   ds      NFRAG/8         ; the fragments kept
