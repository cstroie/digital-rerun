;	GEMINI: a Gemini client for the modem port
;
;	A>GEMINI		the home page: the capsules of GEMINI.DIR
;	A>GEMINI host[:port][/path]	there at once (gemini:// may lead)
;
;	A page shows its links numbered: type the number and Return to follow
;	one. Space and N the next page, P or - the one before, B back, G go to
;	an address, H home, R again, W saves the page (its gemtext) to a file,
;	Q quits, ? lists the keys. Esc stops a page that is coming (at a G or
;	search prompt Ctrl-P and Ctrl-N bring back the last 10). A page is read whole, then
;	shown: headings bold, lists and quotes set in, paragraphs wrapped at
;	the words, preformatted text as it is. A capsule that asks for input
;	(a search) gets it; a redirect is followed (five at most).
;
;	Gemini needs TLS, which an 8080 cannot do: the modem's bridge speaks it
;	to the capsule (DigitalRerun's does for port 1965) and this program sees
;	plain bytes. GEMINI.DIR: a capsule per line, a gemini:// address and a
;	name.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
conio	equ	6		;direct console I/O: E = 0FFh reads a key (A = 0: none)
print	equ	9
closef	equ	16
openf	equ	15
delete	equ	19
readsq	equ	20
writsq	equ	21
makef	equ	22
setdma	equ	26
clk	equ	20		;the clock port: OUT latches, IN reads the record
mst	equ	6		;modem status: bit 0 byte waiting, bit 1 may send, bit 2 carrier
mctl	equ	6		;modem control: bit 0 DTR
mdat	equ	7		;modem data
cr	equ	13
lf	equ	10
tab	equ	9
rmask	equ	03h		;the ring is 1K: its offsets wrap at 0400h
rows	equ	22		;rows of a page (2 to 23)
maxrow	equ	1500		;rows of a page that can be shown
maxlnk	equ	255		;links of a page
hmax	equ	8		;the way back: so many places
nhst	equ	10		;lines typed at a prompt kept for Ctrl-P (G, the searches)
gport	equ	1965		;Gemini's port
;	a place: its kind ('H' home, 'G' a capsule), port, the first row shown, host, path
ltype	equ	0
lport	equ	1
ltop	equ	3
lhost	equ	8
lpath	equ	72
lsize	equ	256
;	the kinds of rows
ktext	equ	0
khead	equ	1
klink	equ	2
klink2	equ	3
klist	equ	4
klist2	equ	5
kquote	equ	6
kpre	equ	7

	org	100h
	lxi	h,0
	dad	sp
	shld	savesp
	lxi	sp,stktop
	in	mst
	cpi	0ffh		;nothing answers: no modem here
	lxi	d,nomsg
	jz	quitm
	lhld	6		;the page is read into the room up to the BDOS
	dcr	h
	mvi	l,0
	shld	docend
	call	getarg
	call	minit
	xra	a
	sta	hcnt
	sta	nlen
	lxi	h,0
	shld	msg
	lda	cmdarg
	ora	a
	jz	start1
	lxi	h,cmdarg
	call	paddr		;into NEWL
	jc	start1
	lxi	h,newl
	lxi	d,cur
	call	copyl
	call	load
	jnc	view
	shld	msg
start1:	call	home
view:	call	index
	lhld	cur+ltop
	shld	top
vdraw:	call	draw
vprom:	call	prompt
vkey:	call	poll
	call	keyin
	ora	a
	jz	vkey
	cpi	'0'
	jc	vk1
	cpi	'9'+1
	jc	vdigit
vk1:	cpi	cr
	jz	venter
	cpi	8
	jz	vbksp
	cpi	7fh
	jz	vbksp
	cpi	1bh
	jz	vesc
	cpi	'?'		;before the upper case below: ? is the help
	jz	vhelp
	cpi	' '
	jz	vnext
	cpi	'-'
	jz	vprev
	ani	5fh		;upper case
	cpi	'N'
	jz	vnext
	cpi	'P'
	jz	vprev
	cpi	'B'
	jz	vback
	cpi	'U'
	jz	vback
	cpi	'G'
	jz	vgo
	cpi	'H'
	jz	vhome
	cpi	'R'
	jz	vagain
	cpi	'W'
	jz	vwrite
	cpi	'Q'
	jz	vquit
	jmp	vkey

;	a digit of the number of a link
vdigit:	mov	b,a
	lda	nlen
	cpi	3
	jnc	vkey
	mov	e,a
	mvi	d,0
	inr	a
	sta	nlen
	lxi	h,nbuf
	dad	d
	mov	m,b
	mov	a,b
	call	cout
	jmp	vkey
vbksp:	lda	nlen
	ora	a
	jz	vkey
	dcr	a
	sta	nlen
	lxi	h,sbs
	call	pz
	jmp	vkey
vesc:	xra	a
	sta	nlen
	jmp	vprom

;	?: the keys, on a page of their own; any key goes back to the page
vhelp:	xra	a
	sta	nlen
	lxi	h,scls
	call	pz
	lxi	h,hgem
	call	hlines
	call	anykey
	jmp	vdraw

;	B: back the way we came (the page before is read again)
vback:	xra	a
	sta	nlen
	lda	hcnt
	ora	a
	lxi	h,mnoback
	jz	vmsg
	call	hpop
	lda	cur+ltype
	cpi	'H'
	jz	vb1
	call	load
	jnc	view
	shld	msg
vb1:	call	home
	jmp	view

;	G: go to an address
vgo:	xra	a
	sta	nlen
	lxi	h,pgo
	call	input
	jc	vprom
	jz	vprom
	lxi	h,ibuf
	call	paddr
	lxi	h,mbadad
	jc	vmsg
	call	going		;(it goes on to the new page)

;	H: home
vhome:	xra	a
	sta	nlen
	lhld	top
	shld	cur+ltop
	call	hpush
	call	home
	jmp	view

;	R: the same page again
vagain:	xra	a
	sta	nlen
	lda	cur+ltype
	cpi	'H'
	jz	vhome
	lhld	top
	shld	cur+ltop
	call	load
	jnc	view
	shld	msg
	jmp	view

vquit:	call	mfini
	lxi	h,sbye
	call	pz
exit:	lhld	savesp
	sphl
	ret
quitm:	mvi	c,print
	call	bdos
	jmp	exit

;	follow link HL (1 the first of the page)
follow:	mov	a,h
	ora	a
	jnz	fnone
	ora	l
	jz	fnone
	lda	nlinks
	cmp	l
	jc	fnone
	dcx	h
	dad	h
	lxi	d,links
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	xchg			;HL = the link's address in the page
	lxi	d,ubuf		;copied: up to a blank or the end of the line
	mvi	b,250
fo1:	mov	a,m
	cpi	21h
	jc	fo2
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	fo1
fo2:	xra	a
	stax	d
	call	resolve		;against CUR, into NEWL
	jnc	going
	lxi	h,mnotgem
	shld	msg
	ret
fnone:	lxi	h,mnosuch
	shld	msg
	ret

;	NEWL is where to go: the way back keeps where we are
going:	lhld	top
	shld	cur+ltop
	call	hpush
	lxi	h,newl
	lxi	d,cur
	call	copyl
	lxi	h,0
	shld	cur+ltop
	call	load
	jnc	gn1
	shld	msg		;no: back where we were (the page is still there)
	call	hpop
gn1:	pop	h		;the caller's return: straight to the new page
	jmp	view

;	---- a page: asked for, its answer read and taken ----

;	load CUR: CY set (and HL what went wrong) only if the first call failed, the page as it was;
;	else the page is what came (or a page of our own that says what went wrong)
load:	mvi	a,5
	sta	redirs
	xra	a
	sta	clob
lo0:	call	fetch
	jnc	lo1
	lda	clob		;a later call failed: the page was taken already, say so on one
	ora	a
	stc
	rz
	xchg
	lxi	h,tfail
	jmp	mkpage
lo1:	mvi	a,1
	sta	clob
	call	status		;the header: A its first digit, META its words, BODYP the rest
	cpi	'2'
	jz	lo2
	cpi	'1'
	jz	loin
	cpi	'3'
	jz	lore
	cpi	'6'
	lxi	d,mcert
	jz	lo9
	cpi	'4'
	jz	loerr
	cpi	'5'
	jz	loerr
	lxi	h,tbad		;not a Gemini answer
	lxi	d,meta
	jmp	mkpage
loerr:	lxi	d,meta
lo9:	lxi	h,terr
	jmp	mkpage
;	20: the page, if it is text
lo2:	lxi	h,meta
	mov	a,m
	ora	a
	jz	logem		;no type: gemtext
	lxi	d,sgemt
	call	startsi
	jz	logem
	lxi	h,meta
	lxi	d,stext
	call	startsi
	jnz	lobin
	mvi	a,'t'		;other text: shown as it is
	sta	mode
	ora	a
	ret
logem:	mvi	a,'g'
	sta	mode
	ora	a
	ret
lobin:	lxi	h,tbin
	lxi	d,meta
	jmp	mkpage
;	10, 11: the capsule asks for words (a search): they go after a ? and the call is made again
loin:	lxi	h,meta	;the prompt: its words (60 at most) and ?
	lxi	d,qbuf
	mvi	b,60
lq1:	mov	a,m
	ora	a
	jz	lq2
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	lq1
lq2:	lxi	h,sqsp
	call	wstr
	xra	a
	stax	d
	lxi	h,qbuf
	call	input
	lxi	h,tnoin
	lxi	d,meta
	jc	mkpage
	jz	mkpage
	lxi	h,cur+lpath	;the path, without the query it had
li1:	mov	a,m
	ora	a
	jz	li2
	cpi	'?'
	jz	li2
	inx	h
	jmp	li1
li2:	mvi	m,'?'
	inx	h
	xchg
	lxi	h,ibuf
	call	pctenc
	jmp	lo0
;	3x: elsewhere: the address, as a link would be, against this one
lore:	lda	redirs
	dcr	a
	sta	redirs
	lxi	h,tloop
	lxi	d,meta
	jz	mkpage
	lxi	h,meta
	lxi	d,ubuf
lr1:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	lr1
	call	resolve
	lxi	h,tnotgem
	lxi	d,meta
	jc	mkpage
	lxi	h,newl
	lxi	d,cur
	call	copyl
	jmp	lo0

;	a page of our own: a heading (HL) and a line (DE); mode gemtext, nothing to go back to lost
mkpage:	push	d
	push	h
	lhld	docbeg
	shld	bodyp
	xchg
	mvi	a,'#'
	stax	d
	inx	d
	mvi	a,' '
	stax	d
	inx	d
	pop	h
	call	wstr
	mvi	a,lf
	stax	d
	inx	d
	stax	d
	inx	d
	pop	h
	call	wstr
	mvi	a,lf
	stax	d
	inx	d
	xra	a
	stax	d
	mvi	a,'g'
	sta	mode
	ora	a
	ret

;	the header of the answer: two digits, a blank, the words (META, 0-ended), CR LF (the CR is
;	gone already); BODYP after it. A: the first digit, or 0 if it is no header.
status:	lhld	docbeg
	mov	a,m
	call	isdig
	jnc	st9
	inx	h
	mov	a,m
	call	isdig
	jnc	st9
	inx	h
st1:	mov	a,m		;blanks
	cpi	' '
	jz	st1a
	cpi	tab
	jnz	st2
st1a:	inx	h
	jmp	st1
st2:	lxi	d,meta		;the words, 120 at most, up to the line end
	mvi	b,120
st3:	mov	a,m
	ora	a
	jz	st4
	inx	h
	cpi	lf
	jz	st4
	stax	d
	inx	d
	dcr	b
	jnz	st3
st3a:	mov	a,m		;the rest of a long one goes
	ora	a
	jz	st4
	inx	h
	cpi	lf
	jnz	st3a
st4:	xra	a
	stax	d
	shld	bodyp
	lhld	docbeg
	mov	a,m
	ret
st9:	xra	a
	sta	meta
	lhld	docbeg
	shld	bodyp
	xra	a
	ret

;	read the place CUR: CY set and HL what went wrong if the call failed
fetch:	lhld	cur+lport	;the port in decimal after a colon
	lxi	d,pbuf
	mvi	a,':'
	stax	d
	inx	d
	call	wnum
	xra	a
	stax	d
	call	rowmsg
	lxi	h,mdialg
	call	pz
	lxi	h,cur+lhost
	call	pz
	lxi	h,cur+lhost
	lxi	d,pbuf
	call	mkdial
	call	mdial
	rc
	lxi	h,sproto	;gemini://host[:port]/path CR LF
	call	txz
	lxi	h,cur+lhost
	call	txz
	lhld	cur+lport
	lxi	d,-gport
	dad	d
	mov	a,h
	ora	l
	jz	fe0
	lxi	h,pbuf
	call	txz
fe0:	lxi	h,cur+lpath
	mov	a,m
	ora	a
	jnz	fe0a
	lxi	h,sslash
fe0a:	call	txz
	lxi	h,scrlf
	call	txz
	call	rowmsg
	lxi	h,mread
	call	pz
	lhld	docbeg
	shld	dptr
	lxi	h,0
	shld	count
fe1:	call	poll
	call	rget
	jnc	fe2
	in	mst
	ani	4
	jz	fe9		;the capsule has hung up: it is all here
	call	keyin
	cpi	1bh
	jnz	fe1
	jmp	fe8		;Esc: what came is enough
fe2:	call	keep
	jnc	fe1
fe8:	call	hangup		;the page is full, or Esc
	jmp	fe9a
fe9:	lxi	h,300		;the modem's NO CARRIER goes
	call	delay
	call	flush
fe9a:	lhld	dptr		;the page ends with a line end and a 0
	dcx	h
	mov	a,m
	inx	h
	cpi	lf
	jz	fe9b
	mvi	m,lf
	inx	h
fe9b:	mvi	m,0
	ora	a
	ret

;	a byte from the capsule (A) into the page: CY set if the page is full
keep:	cpi	cr
	jz	kp9
	cpi	tab
	jnz	kp0
	mvi	a,' '		;a tab: a blank
kp0:	cpi	lf
	jz	kp1
	cpi	20h
	jc	kp9		;other control characters go
	cpi	7fh
	jc	kp1
	jz	kp9
	cpi	0c0h
	jc	kp9		;the inside of a UTF-8 character
	mvi	a,'?'		;its first byte: one ?
kp1:	lhld	dptr
	mov	m,a
	inx	h
	shld	dptr
	xchg
	lhld	docend
	dcx	h
	dcx	h
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	cmc
	rc			;full
	lhld	count		;the count on the bottom row, now and then
	inx	h
	shld	count
	mov	a,l
	ani	7fh
	jnz	kp9
	call	rowmsg
	lxi	h,mread
	call	pz
	lhld	count
	call	pnum
	lxi	h,mbytes
	call	pz
kp9:	ora	a
	ret

;	---- the page made rows: gemtext wrapped at the words, plain text cut ----

;	a row: where its text is (2 bytes), how long (1), its kind (1), the link's number (1)
index:	lxi	h,0
	shld	nlines
	xra	a
	sta	nlinks
	sta	pre
	sta	lnum
	lhld	bodyp
ix1:	mov	a,m
	ora	a
	rz
	lda	mode
	cpi	't'
	jz	ixpre		;plain text: every line as it is
	mov	a,m
	cpi	'`'		;``` opens or closes preformatted text (the line itself is not shown)
	jnz	ix2
	inx	h
	mov	a,m
	dcx	h
	cpi	'`'
	jnz	ix2
	inx	h
	inx	h
	mov	a,m
	dcx	h
	dcx	h
	cpi	'`'
	jnz	ix2
	lda	pre
	xri	1
	sta	pre
	call	skipln
	jmp	ix1
ix2:	lda	pre
	ora	a
	jnz	ixpre
	mov	a,m
	cpi	'='
	jnz	ix3
	inx	h
	mov	a,m
	dcx	h
	cpi	'>'
	jz	ixlink
ix3:	mov	a,m
	cpi	'#'
	jz	ixhead
	cpi	'>'
	jz	ixquot
	cpi	'*'
	jnz	ixtext
	inx	h
	mov	a,m
	dcx	h
	cpi	' '
	jz	ixlist
ixtext:	mvi	b,79
	mvi	c,ktext
	mvi	d,ktext
	call	wrap
	rc
	jmp	ix1
ixhead:	mov	a,m		;the #s and the blanks after them go
	cpi	'#'
	jz	ih1
	cpi	' '
	jnz	ih2
ih1:	inx	h
	jmp	ixhead
ih2:	mvi	b,79
	mvi	c,khead
	mvi	d,khead
	call	wrap
	rc
	jmp	ix1
ixquot:	inx	h		;> and a blank after it
	mov	a,m
	cpi	' '
	jnz	iq1
	inx	h
iq1:	mvi	b,75
	mvi	c,kquote
	mvi	d,kquote
	call	wrap
	rc
	jmp	ix1
ixlist:	inx	h		;* and the blank
	inx	h
	mvi	b,75
	mvi	c,klist
	mvi	d,klist2
	call	wrap
	rc
	jmp	ix1
;	=> address [name]: the link kept, the name shown (the address if there is none)
ixlink:	inx	h
	inx	h
il1:	mov	a,m		;blanks
	cpi	' '
	jnz	il2
	inx	h
	jmp	il1
il2:	cpi	lf		;=> and nothing: an empty row
	jz	ixtext
	ora	a
	jz	ixtext
	lda	nlinks
	cpi	maxlnk
	jnc	ixtext		;too many links: shown as text
	inr	a
	sta	nlinks
	sta	lnum
	dcr	a
	push	h
	mov	e,a
	mvi	d,0
	lxi	h,links
	dad	d
	dad	d
	pop	d		;DE the address
	mov	m,e
	inx	h
	mov	m,d
	xchg
	push	h		;its start: shown if there is no name
il3:	mov	a,m		;past the address
	cpi	21h
	jc	il4
	inx	h
	jmp	il3
il4:	mov	a,m		;blanks
	cpi	' '
	jnz	il5
	inx	h
	jmp	il4
il5:	cpi	lf
	jz	il6
	ora	a
	jnz	il7
il6:	pop	h		;no name: the address
	jmp	il8
il7:	pop	d		;a name: from here
il8:	mvi	b,74
	mvi	c,klink
	mvi	d,klink2
	call	wrap
	rc
	xra	a
	sta	lnum
	jmp	ix1
;	a line as it is: rows of 79, cut, not wrapped
ixpre:	xra	a
	sta	lnum
ip1:	push	h
	mvi	c,0
ip2:	mov	a,m
	ora	a
	jz	ip3
	cpi	lf
	jz	ip3
	inx	h
	inr	c
	mov	a,c
	cpi	79
	jc	ip2
ip3:	pop	d		;DE the start, C the length
	push	h
	xchg
	mov	b,c
	mvi	c,kpre
	call	addrow
	pop	h
	rc
	mov	a,m
	ora	a
	rz
	cpi	lf
	jnz	ip1		;79 and more: the rest on a row of its own
	inx	h
	jmp	ix1

;	the rest of the line at HL: past its end
skipln:	mov	a,m
	ora	a
	rz
	inx	h
	cpi	lf
	jnz	skipln
	ret

;	the text at HL up to the line end as rows of B at most, broken at a blank: the first of kind C,
;	the others of kind D (LNUM the link's number on the first); HL after the line. CY: no more room.
wrap:	mov	a,b
	sta	wwid
	mov	a,d
	sta	wkind2
	mov	a,c
	sta	wkind
wr0:	mov	d,h		;DE walks, B counts, LASTSP the last blank seen
	mov	e,l
	mvi	b,0
	push	h
	lxi	h,0
	shld	lastsp
	pop	h
ww1:	ldax	d
	ora	a
	jz	wwend
	cpi	lf
	jz	wwend
	lda	wwid
	cmp	b
	jz	wwbrk
	ldax	d
	cpi	' '
	jnz	ww2
	xchg
	shld	lastsp
	xchg
ww2:	inx	d
	inr	b
	jmp	ww1
;	the line ends here: the last row
wwend:	push	d
	call	emit
	pop	h
	rc
	mov	a,m
	ora	a
	rz
	inx	h		;past the LF
	ret
;	the row is full: back to the last blank, if there was one
wwbrk:	push	h
	lhld	lastsp
	mov	a,h
	ora	l
	pop	h
	jz	wwcut
	push	h		;B = LASTSP - HL
	xchg
	lhld	lastsp
	mov	a,l
	sub	e
	mov	b,a
	inx	h
	xchg			;DE after the blank
	pop	h
wwcut:	push	d
	call	emit
	pop	h
	rc
ww3:	mov	a,m		;blanks at the start of the next row go
	cpi	' '
	jnz	ww4
	inx	h
	jmp	ww3
ww4:	cpi	lf
	jz	wwlf
	ora	a
	rz
	lda	wkind2
	sta	wkind
	xra	a
	sta	lnum
	jmp	wr0
wwlf:	inx	h
	ret
;	a row: HL its text, B its length, of kind WKIND
emit:	lda	wkind
	mov	c,a
;	a row: HL its text, B its length, C its kind (LNUM its link's number); CY set if there is no room
addrow:	push	h
	lhld	nlines
	push	d
	lxi	d,maxrow
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	pop	d
	cmc
	jc	ar9
	push	h
	inx	h
	shld	nlines
	pop	h
	mov	d,h		;* 5
	mov	e,l
	dad	h
	dad	h
	dad	d
	lxi	d,rowt
	dad	d
	pop	d		;the text
	mov	m,e
	inx	h
	mov	m,d
	inx	h
	mov	m,b
	inx	h
	mov	m,c
	inx	h
	lda	lnum
	mov	m,a
	xchg
	ora	a
	ret
ar9:	pop	h
	ret

;	row HL of the page
prow:	mov	d,h		;* 5
	mov	e,l
	dad	h
	dad	h
	dad	d
	lxi	d,rowt
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	inx	h
	mov	b,m
	inx	h
	mov	a,m		;the kind
	sta	pkind
	inx	h
	mov	c,m		;the link's number
	push	d
	push	b
	cpi	khead
	lxi	h,sbold
	jz	pw1
	cpi	klink
	jz	pwlink
	cpi	klink2
	lxi	h,s5sp
	jz	pw1
	cpi	klist
	lxi	h,sbull
	jz	pw1
	cpi	klist2
	lxi	h,s4sp
	jz	pw1
	cpi	kquote
	lxi	h,squot
	jz	pw1
	lxi	h,nul
pw1:	call	pz
	jmp	pw2
pwlink:	mov	l,c		;the number, three wide, and two blanks
	mvi	h,0
	mvi	a,' '
	sta	lead
	call	pnum3
	lxi	h,s2sp
	call	pz
pw2:	pop	b
	pop	h
	mov	a,b
	ora	a
	jz	pw4
pw3:	mov	a,m
	call	cout
	inx	h
	dcr	b
	jnz	pw3
pw4:	lda	pkind		;a heading ends bold
	cpi	khead
	rnz
	lxi	h,snorm0
	jmp	pz

;	the top row: GEMINI, where we are
bar:	lxi	h,sbar
	call	pz
	mvi	a,70
	sta	room
	lda	cur+ltype
	cpi	'H'
	lxi	h,shome
	jz	ba2
	lxi	h,cur+lhost
	call	pzr
	lhld	cur+lport
	lxi	d,-gport
	dad	d
	mov	a,h
	ora	l
	jz	ba1
	mvi	a,':'
	call	cr1
	lhld	cur+lport
	lxi	d,pbuf
	call	wnum
	xra	a
	stax	d
	lxi	h,pbuf
	call	pzr
ba1:	lxi	h,cur+lpath
ba2:	call	pzr
	lxi	h,sbarz
	jmp	pz

;	the bottom row: a word (if one waits), where in the page, the keys, the number typed
prompt:	call	rowmsg
	lhld	msg
	mov	a,h
	ora	l
	jz	pm1
	push	h
	lxi	h,srev
	call	pz
	pop	h
	call	pz
	lxi	h,snorm
	call	pz
	lxi	h,0
	shld	msg
pm1:	mvi	a,'['
	call	cout
	lhld	top
	inx	h
	call	pnum
	mvi	a,'-'
	call	cout
	lhld	top		;the last row shown
	lxi	d,rows
	dad	d
	xchg
	lhld	nlines
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jc	pm2
	xchg
pm2:	call	pnum
	mvi	a,'/'
	call	cout
	lhld	nlines
	call	pnum
	mvi	a,']'
	call	cout
	mvi	a,' '
	call	cout
	lda	nlinks		;the links of the page, then the keys
	mov	l,a
	mvi	h,0
	call	pnum
	lxi	h,slnk
	call	pz
	lxi	h,skeys
	call	pz
	lda	nlen		;the number typed so far
	ora	a
	rz
	mov	b,a
	lxi	h,nbuf
pm3:	mov	a,m
	call	cout
	inx	h
	dcr	b
	jnz	pm3
	ret

;	---- addresses ----

;	an address typed or given (gemini:// may lead; host[:port][/path]) into NEWL; CY set if it is none
paddr:	push	h
	lxi	d,sproto	;gemini:// is skipped
	call	startsi
	pop	h
	jnz	pd0
	lxi	d,9
	dad	d
	jmp	pd1
pd0:	push	h		;another scheme (xyz://): not for us; host:port is no scheme
	call	scheme
	jnc	pd0a
	inx	h
	mov	a,m
	cpi	'/'
	jnz	pd0a
	inx	h
	mov	a,m
	cpi	'/'
	jnz	pd0a
	pop	h
	stc
	ret
pd0a:	pop	h
pd1:	call	pauth		;host and port into NEWL
	rc
	lxi	d,newl+lpath	;the path: what is left (none: /)
	mov	a,m
	cpi	'/'
	jz	pd2
	mvi	a,'/'
	stax	d
	inx	d
pd2:	mvi	b,180
pd3:	mov	a,m
	cpi	21h
	jc	pd4
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	pd3
pd4:	xra	a
	stax	d
	mvi	a,'G'
	sta	newl+ltype
	call	normal
	ora	a
	ret

;	CY set if HL begins with a scheme: letters, digits, + - . and then a colon
scheme:	mov	a,m
	call	isalnum
	jnc	sc9
	mvi	b,0
sc1:	mov	a,m
	cpi	':'
	jz	sc8
	call	isalnum
	jc	sc2
	cpi	'+'
	jz	sc2
	cpi	'-'
	jz	sc2
	cpi	'.'
	jnz	sc9
sc2:	inx	h
	inr	b
	jnz	sc1
sc9:	ora	a
	ret
sc8:	stc
	ret

;	host[:port] at HL into NEWL (the host in lower case, the port 1965 if none); HL after it.
;	CY set if there is no host.
pauth:	lxi	d,newl+lhost
	mvi	b,63
pa1:	mov	a,m
	cpi	21h
	jc	pa2
	cpi	':'
	jz	pa2
	cpi	'/'
	jz	pa2
	cpi	'?'
	jz	pa2
	call	lower
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	pa1
pa2:	xra	a
	stax	d
	mov	a,b
	cpi	63
	stc
	rz			;no host
	push	h
	lxi	h,gport
	shld	newl+lport
	pop	h
	mov	a,m
	cpi	':'
	jnz	pa3
	inx	h
	call	rdnum
	jc	pa3
	xchg
	shld	newl+lport
	xchg
pa3:	ora	a
	ret

;	the address of a link (UBUF) against the place CUR, into NEWL; CY set if it is not gemini
resolve:lxi	h,ubuf		;a fragment (#...) is the page's own: it goes
rs0:	mov	a,m
	ora	a
	jz	rs1
	cpi	'#'
	jz	rs0a
	inx	h
	jmp	rs0
rs0a:	mvi	m,0
rs1:	lxi	h,ubuf
	lxi	d,sproto
	call	startsi
	jnz	rs2
	lxi	h,ubuf		;gemini://...: as typed
	jmp	paddr
rs2:	lxi	h,ubuf
	push	h
	call	scheme
	pop	h
	rc			;http:, gopher:, mailto: ...: not for us
	mvi	a,'G'
	sta	newl+ltype
	mov	a,m
	cpi	'/'
	jnz	rs4
	inx	h
	mov	a,m
	dcx	h
	cpi	'/'
	jnz	rs3
	inx	h		;//host/path: this scheme, another host
	inx	h
	jmp	pd1
rs3:	call	samehost	;/path: this host
	lxi	d,newl+lpath
	jmp	rscopy
rs4:	call	samehost
	lxi	h,cur+lpath	;relative: the base's path, then the link
	lxi	d,newl+lpath
	lda	ubuf
	cpi	'?'
	jz	rsq
	ora	a
	jz	rsall
;	up to the last / of the base's path (before its ?)
	push	d
	lxi	b,0		;BC: where in DE the last / went
rs5:	mov	a,m
	ora	a
	jz	rs6
	cpi	'?'
	jz	rs6
	stax	d
	cpi	'/'
	jnz	rs5a
	mov	b,d
	mov	c,e
rs5a:	inx	h
	inx	d
	jmp	rs5
rs6:	pop	d
	mov	a,b
	ora	c
	jz	rs7		;no / at all: from the root
	mov	d,b
	mov	e,c
rs7:	mvi	a,'/'
	stax	d
	inx	d
	lxi	h,ubuf
	jmp	rscopy
rsq:	mov	a,m		;?query: the base's path, the new query
	ora	a
	jz	rsq1
	cpi	'?'
	jz	rsq1
	stax	d
	inx	h
	inx	d
	jmp	rsq
rsq1:	lxi	h,ubuf
	jmp	rscopy
rsall:	mov	a,m		;nothing: the base itself
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	rsall
	ora	a
	ret
;	the rest (HL) after DE, cut to fit, and the path normalized
rscopy:	push	h
	lxi	h,newl+lpath+180
	call	room8		;room left
	pop	h
rc1:	mov	a,m
	ora	a
	jz	rc2
	dcr	b
	jz	rc2
	stax	d
	inx	h
	inx	d
	jmp	rc1
rc2:	xra	a
	stax	d
	call	normal
	ora	a
	ret
;	NEWL's host and port: CUR's
samehost:
	push	h
	lxi	h,cur+lhost
	lxi	d,newl+lhost
sh1:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	sh1
	lhld	cur+lport
	shld	newl+lport
	pop	h
	ret

;	NEWL's path with its . and .. taken out (RFC 3986), the query kept as it is
normal:	lxi	h,newl+lpath
	lxi	d,tbuf
	mov	a,m
	cpi	'/'
	jz	nm1
	mvi	a,'/'		;a path is absolute here
	stax	d
	inx	d
	dcx	h
nm1:	inx	h		;HL at a segment (after its /)
	push	h		;the segment's end: at /, ?, or the end
	mvi	c,0
nm2:	mov	a,m
	ora	a
	jz	nm3
	cpi	'?'
	jz	nm3
	cpi	'/'
	jz	nm3
	inx	h
	inr	c
	jmp	nm2
nm3:	mov	b,a		;B what ended it
	pop	h		;HL the segment, C its length
	mov	a,c
	cpi	1
	jnz	nm4
	mov	a,m
	cpi	'.'
	jz	nmdot
nm4:	mov	a,c
	cpi	2
	jnz	nmseg
	mov	a,m
	cpi	'.'
	jnz	nmseg
	inx	h
	mov	a,m
	dcx	h
	cpi	'.'
	jz	nmup
nmseg:	mvi	a,'/'		;a segment: /, then it
	stax	d
	inx	d
	mov	a,c
	ora	a
	jz	nmnext
nm5:	mov	a,m
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	nm5
	jmp	nmnx2
nmup:	push	h		;..: the last segment written goes
	lxi	h,tbuf
nu1:	mov	a,e		;back from DE to the / before
	cmp	l
	jnz	nu2
	mov	a,d
	cmp	h
	jz	nu3		;nothing to take back
nu2:	dcx	d
	ldax	d
	cpi	'/'
	jnz	nu1
nu3:	pop	h
	inx	h
nmdot:	inx	h		;. (or ..): past it; at the end it leaves a /
	mov	a,b
	cpi	'/'
	jz	nmnx2
	mvi	a,'/'
	stax	d
	inx	d
	jmp	nmnx2
nmnext:	mov	a,b
nmnx2:	mov	a,m
	cpi	'/'
	jz	nm1
;	the end, or the query: as it is
nm6:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	nm6
	lxi	h,tbuf		;back into NEWL
	lxi	d,newl+lpath
nm7:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	nm7
	ret

;	the text at HL percent-encoded after DE (letters, digits and -._~ as they are), 0-ended; the
;	path does not grow past its room
pctenc:	push	h
	lxi	h,cur+lpath+176
	call	room8		;room
	pop	h
pe1:	mov	a,m
	ora	a
	jz	pe9
	inx	h
	call	isalnum
	jc	pe2
	cpi	'-'
	jz	pe2
	cpi	'.'
	jz	pe2
	cpi	'_'
	jz	pe2
	cpi	'~'
	jz	pe2
	mov	c,a		;%xx
	mov	a,b
	cpi	4
	jc	pe9
	sui	3
	mov	b,a
	mvi	a,'%'
	stax	d
	inx	d
	mov	a,c
	rrc
	rrc
	rrc
	rrc
	call	hexd
	stax	d
	inx	d
	mov	a,c
	call	hexd
	stax	d
	inx	d
	jmp	pe1
pe2:	mov	c,a
	dcr	b
	jz	pe9
	mov	a,c
	stax	d
	inx	d
	jmp	pe1
pe9:	xra	a
	stax	d
	ret
hexd:	ani	0fh
	adi	'0'
	cpi	'9'+1
	rc
	adi	7
	ret

;	Z set if the text at HL begins with the one at DE (letters in either case)
startsi:ldax	d
	ora	a
	rz
	call	lower
	mov	b,a
	mov	a,m
	call	lower
	cmp	b
	rnz
	inx	h
	inx	d
	jmp	startsi

;	CY set if A is a digit; ISALNUM: a letter or a digit
isdig:	cpi	'0'
	jc	idn
	cpi	'9'+1
	jnc	idn
	stc
	ret
idn:	ora	a
	ret
isalnum:call	isdig
	rc
	push	psw
	ori	20h
	cpi	'a'
	jc	ia9
	cpi	'z'+1
	jnc	ia9
	pop	psw
	stc
	ret
ia9:	pop	psw
	ora	a
	ret

;	---- the home page: GEMINI.DIR made links ----

home:	mvi	a,'H'
	sta	cur+ltype
	mvi	a,'g'
	sta	mode
	lxi	h,0
	shld	cur+ltop
	lhld	docend		;the file is read into the last 4K of the room
	lxi	d,-4096
	dad	d
	shld	dirp
	call	loaddir
	jnc	hm0
	lhld	dirp		;no GEMINI.DIR: one capsule
	xchg
	lxi	h,defdir
hm00:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	hm00
hm0:	lhld	docbeg
	shld	bodyp
	xchg
	lxi	h,shead		;the lines on top
	call	wstr
	lhld	dirp
hm1:	mov	a,m		;a line of the file: blanks before it go
	cpi	1ah
	jz	hm9
	ora	a
	jz	hm9
	cpi	21h
	jnc	hm2
	inx	h
	jmp	hm1
hm2:	push	h		;=> and the line
	lxi	h,slink
	call	wstr
	pop	h
hm3:	mov	a,m
	cpi	20h
	jc	hm4
	stax	d
	inx	h
	inx	d
	jmp	hm3
hm4:	mvi	a,lf
	stax	d
	inx	d
	jmp	hm1
hm9:	xra	a
	stax	d
	ret
;	B = the room from DE up to HL (255 at most)
room8:	mov	a,l
	sub	e
	mov	l,a
	mov	a,h
	sbb	d
	mov	b,l
	rz
	mvi	b,255
	ret

;	---- shared with GOPHER ----

;	---- the page: read, indexed, shown ----

;	---- the home menu: GOPHER.DIR made a menu ----

;	W: what is shown to a file, as CP/M text
vwrite:	xra	a
	sta	nlen
	mvi	a,1
	sta	noh		;a file name is not kept for Ctrl-P
	lxi	h,psave
	call	input
	mvi	a,0
	sta	noh
	jc	vprom
	jz	vprom
	call	mkfcb
	lxi	h,mbadfn
	jc	vmsg
	lxi	d,fcb
	mvi	c,delete
	call	bdos
	lxi	d,fcb
	mvi	c,makef
	call	bdos
	inr	a
	lxi	h,mdiskf
	jz	vmsg
	lxi	h,rec
	shld	recp
	lhld	bodyp
wr1:	mov	a,m
	ora	a
	jz	wr8
	inx	h
	cpi	lf
	jnz	wr2
	mvi	a,cr
	call	wbyte
	jc	wr9
	mvi	a,lf
wr2:	call	wbyte
	jc	wr9
	jmp	wr1
wr8:	mvi	a,1ah		;^Z, and the record filled with them
	call	wbyte
	jc	wr9
	lhld	recp
	lxi	d,rec
	mov	a,l
	cmp	e
	jz	wr8b
wr8a:	mvi	a,1ah
	call	wbyte
	jc	wr9
	lhld	recp
	lxi	d,rec
	mov	a,l
	cmp	e
	jnz	wr8a
wr8b:	lxi	d,fcb
	mvi	c,closef
	call	bdos
	lxi	d,80h
	mvi	c,setdma
	call	bdos
	lxi	h,msaved
	jmp	vmsg
wr9:	lxi	d,80h
	mvi	c,setdma
	call	bdos
	lxi	h,mdiskf
	jmp	vmsg
;	HL (0-999) three wide, blanks before it
pnum3:	mvi	a,' '
	sta	lead
	lxi	d,100
	call	pdig
	lxi	d,10
	call	pdig
	mov	a,l
	adi	'0'
	jmp	cout

;	---- the page viewer ----
;	a table of lines (0-ended, each a string), each on a row of its own
hlines:	mov	e,m
	inx	h
	mov	d,m
	inx	h
	mov	a,d
	ora	e
	rz
	push	h
	xchg
	call	pz
	lxi	h,scrlf
	call	pz
	pop	h
	jmp	hlines

;	wait for a key
anykey:	call	poll
	call	keyin
	ora	a
	jz	anykey
	ret

;	Return: follow the item numbered; with no number, the next page
venter:	lda	nlen
	ora	a
	jz	vnext
	lxi	h,nbuf		;the number into HL
	mov	b,a
	lxi	d,0
ve1:	push	h
	mov	h,d
	mov	l,e
	dad	h
	dad	h
	dad	d
	dad	h
	xchg
	pop	h
	mov	a,m
	sui	'0'
	add	e
	mov	e,a
	mvi	a,0
	adc	d
	mov	d,a
	inx	h
	dcr	b
	jnz	ve1
	xra	a
	sta	nlen
	xchg
	call	follow
	jmp	vdraw

vnext:	xra	a
	sta	nlen
	lhld	top		;another page if there is more below
	lxi	d,rows
	dad	d
	xchg
	lhld	nlines
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	lxi	h,mend
	jnc	vmsg
	xchg
	shld	top
	jmp	vdraw
vprev:	xra	a
	sta	nlen
	lhld	top
	mov	a,h
	ora	l
	lxi	h,mtop
	jz	vmsg
	lhld	top
	lxi	d,-rows
	dad	d
	jc	vp1		;no borrow: it stays at 0 or more
	lxi	h,0
vp1:	shld	top
	jmp	vdraw
vmsg:	shld	msg
	jmp	vprom

;	the place at HL to the one at DE
copyl:	mvi	b,0
cl1:	mov	a,m
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	cl1
	ret

;	the way back: CUR pushed (the oldest goes when it is full), and popped
hpush:	lda	hcnt
	cpi	hmax
	jc	hp1
	lxi	h,hist+lsize	;full: all move down one
	lxi	d,hist
	mvi	c,hmax-1
hp0:	call	copyl
	dcr	c
	jnz	hp0
	lda	hcnt
	dcr	a
	sta	hcnt
hp1:	call	hslot
	xchg
	lxi	h,cur
	call	copyl
	lda	hcnt
	inr	a
	sta	hcnt
	ret
hpop:	lda	hcnt
	dcr	a
	sta	hcnt
	call	hslot
	lxi	d,cur
	jmp	copyl

;	HL = the slot HCNT of the way back
hslot:	lda	hcnt
	mov	h,a
	mvi	l,0
	lxi	d,hist
	dad	d
	ret

;	the whole screen: the bar, a page of rows from TOP
draw:	lxi	h,scls
	call	pz
	call	bar
	lhld	top
	shld	ent
	mvi	a,rows
	sta	rcnt
dr1:	lhld	ent
	xchg
	lhld	nlines
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	rnc
	lxi	h,scrlf
	call	pz
	lhld	ent
	call	prow
	lhld	ent
	inx	h
	shld	ent
	lda	rcnt
	dcr	a
	sta	rcnt
	jnz	dr1
	ret

;	the text at HL, as much as ROOM says (a tab, the search words after it, as a space)
pzr:	mov	a,m
	ora	a
	rz
	inx	h
	cpi	tab
	jnz	pr1
	mvi	a,' '
pr1:	call	cr1
	jmp	pzr
cr1:	push	psw
	lda	room
	ora	a
	jz	cr2
	dcr	a
	sta	room
	pop	psw
	jmp	cout
cr2:	pop	psw
	ret

;	the cursor to the bottom row, the row cleared
rowmsg:	lxi	h,srow
	jmp	pz

;	a line typed on the bottom row after the text at HL, into IBUF: CY set if Esc, Z set if empty
input:	shld	ipr		;the prompt: Ctrl-P redraws the line after it
	xra	a
	sta	ihpos
	push	h
	call	rowmsg
	pop	h
	call	pz
	mvi	b,0
in1:	push	b
in2:	call	poll
	call	keyin
	ora	a
	jz	in2
	pop	b
	cpi	cr
	jz	in9
	cpi	10h		;Ctrl-P: the line before, Ctrl-N: the one after
	jz	ihprev
	cpi	0eh
	jz	ihnext
	cpi	1bh
	jz	in8
	cpi	8
	jz	in3
	cpi	7fh
	jz	in3
	cpi	' '
	jc	in1
	mov	c,a
	mov	a,b
	cpi	70
	jnc	in1
	mov	e,b
	mvi	d,0
	lxi	h,ibuf
	dad	d
	mov	m,c
	inr	b
	mov	a,c
	push	b
	call	cout
	pop	b
	jmp	in1
in3:	mov	a,b
	ora	a
	jz	in1
	dcr	b
	push	b
	lxi	h,sbs
	call	pz
	pop	b
	jmp	in1
in8:	stc
	ret
in9:	mov	e,b
	mvi	d,0
	lxi	h,ibuf
	dad	d
	mvi	m,0
	mov	a,b
	ora	a		;Z: nothing typed
	push	psw
	call	ihsave
	pop	psw
	ret

;	the line typed kept for Ctrl-P (not an empty one, not a file name: noh)
ihsave:	lda	noh
	ora	a
	rnz
	lda	ibuf
	ora	a
	rz
	lxi	h,ihist+(nhst-1)*80	;all move down one (from the end: the copy overlaps)
	lxi	d,ihist+nhst*80-1
	lxi	b,(nhst-1)*80
ihs1:	dcx	h
	mov	a,m
	stax	d
	dcx	d
	dcx	b
	mov	a,b
	ora	c
	jnz	ihs1
	lxi	h,ibuf
	lxi	d,ihist
ihs2:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	ihs2
	lda	ihcnt
	cpi	nhst
	rnc
	inr	a
	sta	ihcnt
	ret

;	Ctrl-P: the line before (the empty line after the newest); Ctrl-N: the one after
ihprev:	lda	ihpos
	lxi	h,ihcnt
	cmp	m
	jnc	in1
	inr	a
	sta	ihpos
	jmp	ihget
ihnext:	lda	ihpos
	ora	a
	jz	in1
	dcr	a
	sta	ihpos

;	the line ihpos (1 the newest; 0 the empty one) into IBUF, the line redrawn, B its length
ihget:	lda	ihpos
	mvi	b,0
	ora	a
	jnz	ihg0
	lxi	h,ibuf
	mvi	m,0
	jmp	ihg3
ihg0:	dcr	a
	mov	l,a
	mvi	h,0
	dad	h
	dad	h
	dad	h
	dad	h
	push	h
	dad	h
	dad	h
	pop	d
	dad	d		;* 80
	lxi	d,ihist
	dad	d
	lxi	d,ibuf
ihg1:	mov	a,m
	stax	d
	ora	a
	jz	ihg3
	inx	h
	inx	d
	inr	b
	jmp	ihg1
ihg3:	push	b
	call	rowmsg
	lhld	ipr
	call	pz
	lxi	h,ibuf
	call	pz
	pop	b
	jmp	in1

;	the 0-ended text at HL to DE (the 0 left out)
wstr:	mov	a,m
	ora	a
	rz
	stax	d
	inx	h
	inx	d
	jmp	wstr

;	read GOPHER.DIR to DIRP (^Z ends it); CY set if there is none
loaddir:lxi	h,fcb
	call	clrfcb
	lxi	h,fcb+1
	lxi	d,dirname
	mvi	c,11
ld1:	ldax	d
	mov	m,a
	inx	h
	inx	d
	dcr	c
	jnz	ld1
	lxi	d,fcb
	mvi	c,openf
	call	bdos
	inr	a
	stc
	rz
	lhld	dirp
ld2:	push	h
	xchg
	mvi	c,setdma
	call	bdos
	lxi	d,fcb
	mvi	c,readsq
	call	bdos
	pop	h
	ora	a
	jnz	ld3
	lxi	d,128
	dad	d
	push	h
	xchg
	lhld	docend
	lxi	b,-130
	dad	b
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	pop	h
	jc	ld2
ld3:	mvi	m,1ah
	lxi	d,80h
	mvi	c,setdma
	call	bdos
	ora	a
	ret
clrfcb:	mvi	c,36
	xra	a
cf1:	mov	m,a
	inx	h
	dcr	c
	jnz	cf1
	ret

;	HL at decimal digits: their value in DE (5 at most), HL after them; CY set if there are none
rdnum:	lxi	d,0
	mvi	c,0
rn1:	mov	a,m
	sui	'0'
	jc	rn9
	cpi	10
	jnc	rn9
	push	h
	mov	h,d		;DE = DE * 10 + A
	mov	l,e
	dad	h
	dad	h
	dad	d
	dad	h
	mov	e,a
	mvi	d,0
	dad	d
	xchg
	pop	h
	inx	h
	inr	c
	mov	a,c
	cpi	5
	jc	rn1
rn9:	mov	a,c
	ora	a
	stc
	rz
	cmc
	ret

lower:	cpi	'A'
	rc
	cpi	'['
	rnc
	adi	20h
	ret

;	HL in decimal to DE (no 0 after it); DE after it
wnum:	xchg
	shld	wp
	xchg
	xra	a
	sta	lead
	lxi	d,10000
	call	wdig
	lxi	d,1000
	call	wdig
	lxi	d,100
	call	wdig
	lxi	d,10
	call	wdig
	mov	a,l
	adi	'0'
	call	wput
	xchg
	lhld	wp
	xchg
	ret
wdig:	mvi	b,'0'-1
wd1:	inr	b
	mov	a,l
	sub	e
	mov	l,a
	mov	a,h
	sbb	d
	mov	h,a
	jnc	wd1
	dad	d
	mov	a,b
	cpi	'0'
	jnz	wd2
	lda	lead
	ora	a
	rz
wd2:	sta	lead
	mov	a,b
wput:	push	h
	lhld	wp
	mov	m,a
	inx	h
	shld	wp
	pop	h
	ret

;	HL in decimal on the console: no zeros before it (PNUM), or four wide (PNUM4)
pnum:	xra	a
	sta	lead
	lxi	d,10000
	call	pdig
	jmp	pn3
pnum4:	mvi	a,' '
	sta	lead
pn3:	lxi	d,1000
	call	pdig
	lxi	d,100
	call	pdig
	lxi	d,10
	call	pdig
	mov	a,l
	adi	'0'
	jmp	cout
pdig:	mvi	b,'0'-1
pg1:	inr	b
	mov	a,l
	sub	e
	mov	l,a
	mov	a,h
	sbb	d
	mov	h,a
	jnc	pg1
	dad	d
	mov	a,b
	cpi	'0'
	jnz	pg2
	lda	lead		;a zero in front: nothing, a blank, or 0 once it has begun
	ora	a
	rz
	jmp	cout
pg2:	mvi	a,'0'
	sta	lead
	mov	a,b
	jmp	cout

;	a byte (A) into the record, written when it is full: CY set if the disk is (HL kept)
wbyte:	push	h
	lhld	recp
	mov	m,a
	inx	h
	shld	recp
	mov	a,l
	sui	(rec+128) and 0ffh
	jnz	wb9
	lxi	h,rec
	shld	recp
	lxi	d,rec
	mvi	c,setdma
	call	bdos
	lxi	d,fcb
	mvi	c,writsq
	call	bdos
	ora	a
	pop	h
	stc
	rnz
	ora	a
	ret
wb9:	pop	h
	ora	a
	ret

;	IBUF ([d:]name[.typ]) into FCB; CY set if there is no name
mkfcb:	lxi	h,fcb
	call	clrfcb
	lxi	h,fcb+1
	mvi	c,11
mf0:	mvi	m,' '
	inx	h
	dcr	c
	jnz	mf0
	lxi	h,ibuf
	inx	h
	mov	a,m
	dcx	h
	cpi	':'
	jnz	mf1
	mov	a,m
	call	upper
	sui	'A'-1
	sta	fcb
	inx	h
	inx	h
mf1:	lxi	d,fcb+1
	mvi	b,8
	mvi	c,0
mf2:	mov	a,m
	cpi	'.'
	jz	mf3
	cpi	21h
	jc	mf5
	call	upper
	stax	d
	inx	d
	inx	h
	inr	c
	dcr	b
	jnz	mf2
mf2a:	mov	a,m		;a name longer than 8: the rest goes
	cpi	'.'
	jz	mf3
	cpi	21h
	jc	mf5
	inx	h
	jmp	mf2a
mf3:	inx	h
	lxi	d,fcb+9
	mvi	b,3
mf4:	mov	a,m
	cpi	21h
	jc	mf5
	call	upper
	stax	d
	inx	d
	inx	h
	dcr	b
	jnz	mf4
mf5:	mov	a,c
	ora	a
	stc
	rz
	cmc
	ret
upper:	cpi	'a'
	rc
	cpi	'{'
	rnc
	sui	20h
	ret

;	---- the modem ----
;	move what the modem has into the ring (all registers kept); a full ring waits
poll:	push	psw
	push	b
	push	d
	push	h
pl1:	in	mst
	ani	1
	jz	pl9
	lhld	rhead
	inx	h
	mov	a,h
	ani	rmask
	mov	h,a
	xchg			;DE = the head after this byte
	lhld	rtail
	mov	a,l
	cmp	e
	jnz	pl2
	mov	a,h
	cmp	d
	jz	pl9		;full
pl2:	lhld	rhead
	lxi	b,ring
	dad	b
	in	mdat
	mov	m,a
	xchg
	shld	rhead
	jmp	pl1
pl9:	pop	h
	pop	d
	pop	b
	pop	psw
	ret

;	a byte of the ring into A; CY set if it is empty (BC, DE and HL kept)
rget:	push	d
	push	h
	lhld	rtail
	xchg
	lhld	rhead
	mov	a,l
	cmp	e
	jnz	rg1
	mov	a,h
	cmp	d
	jnz	rg1
	pop	h
	pop	d
	stc
	ret
rg1:	lxi	h,ring
	dad	d
	inx	d
	mov	a,d
	ani	rmask
	mov	d,a
	xchg
	shld	rtail
	xchg
	mov	a,m
	pop	h
	pop	d
	ora	a
	ret

;	the last byte taken goes back
unget:	lhld	rtail
	dcx	h
	mov	a,h
	ani	rmask
	mov	h,a
	shld	rtail
	ret

;	forget what is in the ring
flush:	lhld	rhead
	shld	rtail
	ret

;	send A to the modem when it may take it (the receiver is looked at meanwhile)
txb:	push	psw
tb1:	call	poll
	in	mst
	ani	2
	jz	tb1
	pop	psw
	out	mdat
	ret

;	send the 0-ended text at HL
txz:	mov	a,m
	ora	a
	rz
	inx	h
	call	txb
	jmp	txz

;	the low 16 bits of the clock's milliseconds into HL (A and B used)
now:	xra	a
	out	clk		;latch the record
	mvi	b,11
now1:	in	clk
	dcr	b
	jnz	now1
	in	clk
	mov	l,a
	in	clk
	mov	h,a
	ret

;	HL = milliseconds since T0
elapsed:call	now
	xchg
	lhld	t0
	mov	a,e
	sub	l
	mov	l,a
	mov	a,d
	sbb	h
	mov	h,a
	ret

;	wait HL milliseconds, the modem looked at meanwhile
delay:	shld	tlim
	call	now
	shld	t0
dl1:	call	poll
	call	elapsed
	xchg
	lhld	tlim
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	jc	dl1
	ret

;	a key, or 0 (no registers kept)
keyin:	mvi	e,0ffh
	mvi	c,conio
	jmp	bdos

;	DTR up; a call still up (TERM's Q leaves one) is dropped; the modem echoes nothing
minit:	mvi	a,1
	out	mctl
	in	mst
	ani	4
	cnz	hangup
	lxi	h,sate0
	call	txz
	lxi	h,300
	call	delay
	jmp	flush

;	the echo back on, as TERM expects it
mfini:	in	mst
	ani	4
	cnz	hangup
	lxi	h,sate1
	call	txz
	lxi	h,300
	call	delay
	jmp	flush

;	DTR down and up again: the call is dropped
hangup:	xra	a
	out	mctl
	lxi	h,100
	call	delay
	mvi	a,1
	out	mctl
	lxi	h,300
	call	delay
	jmp	flush

;	ATDT, the text at HL (up to a blank or a control character), the text at DE if the
;	first has no colon (a port), CR, 0: into DIALBUF
mkdial:	push	d
	lxi	d,dialbuf+4
	mvi	b,60
	mvi	c,0
mk1:	mov	a,m
	cpi	21h
	jc	mk2
	cpi	':'
	jnz	mk1a
	inr	c
mk1a:	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	mk1
mk2:	pop	h
	mov	a,c
	ora	a
	jnz	mk4		;a port of its own
mk3:	mov	a,m
	ora	a
	jz	mk4
	stax	d
	inx	h
	inx	d
	jmp	mk3
mk4:	mvi	a,cr
	stax	d
	inx	d
	xra	a
	stax	d
	ret

;	dial DIALBUF: CY clear when the carrier is up (the CONNECT line read); else CY set and
;	HL what went wrong (0-ended). A key gives up, so does a minute of nothing.
mdial:	call	flush
	lxi	h,dialbuf
	call	txz
	call	now
	shld	t0
	lxi	h,lbuf
	shld	lptr
md1:	call	poll
	in	mst
	ani	4
	jnz	mdup
	call	keyin
	ora	a
	lxi	h,mcancel
	jnz	mdgive
	call	elapsed
	lxi	d,60000
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	lxi	h,mnoans
	jnc	mdgive
	call	rget
	jc	md1
	cpi	cr
	jz	mdeol
	cpi	lf
	jz	mdeol
	lhld	lptr
	lxi	d,lbuf+76
	mov	b,a
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jnc	md1		;too long: the rest is lost
	mov	m,b
	inx	h
	shld	lptr
	jmp	md1
mdeol:	lhld	lptr
	mvi	m,0
	lxi	h,lbuf
	shld	lptr
	mov	a,m
	cpi	'N'		;NO CARRIER, NO ANSWER, NO DIALTONE
	jz	mdfail
	cpi	'B'		;BUSY
	jz	mdfail
	cpi	'E'		;ERROR
	jnz	md1		;an empty line, OK: on
mdfail:	lxi	h,lbuf
	stc
	ret
mdgive:	push	h		;a byte to the modem stops the dial
	mvi	a,cr
	call	txb
	lxi	h,500
	call	delay
	pop	h
	stc
	ret
mdup:	call	now		;the CONNECT line, if there is one, is not the host's
	shld	t0
mu1:	call	poll
	call	elapsed
	mov	a,h
	cpi	8		;2 seconds
	rnc
	call	rget
	jc	mu1
	cpi	cr
	jz	mu1
	cpi	lf
	jz	mu1
	cpi	'C'
	jnz	mu3
mu2:	call	poll
	call	elapsed
	mov	a,h
	cpi	8
	rnc
	call	rget
	jc	mu2
	cpi	lf
	jnz	mu2
	ora	a
	ret
mu3:	call	unget
	ora	a
	ret

;	---- the console ----

;	one character (A) to the console, then the modem looked at (BC, DE, HL kept)
cout:	push	b
	push	d
	push	h
	mov	e,a
	mvi	c,conio
	call	bdos
	pop	h
	pop	d
	pop	b
	jmp	poll

;	the 0-ended text at HL to the console
pz:	mov	a,m
	ora	a
	rz
	inx	h
	call	cout
	jmp	pz

;	the command line into CMDARG, the blanks before it skipped, in lower case (0-ended, 70 at most)
getarg:	lxi	h,cmdarg
	mvi	m,0
	lda	80h
	ora	a
	rz
	mov	b,a
	lxi	d,81h
ga1:	ldax	d
	cpi	' '
	jnz	ga2
	inx	d
	dcr	b
	jnz	ga1
	ret
ga2:	mvi	c,70
ga3:	ldax	d
	cpi	'A'
	jc	ga4
	cpi	'['
	jnc	ga4
	adi	20h
ga4:	mov	m,a
	inx	h
	inx	d
	dcr	c
	jz	ga9
	dcr	b
	jnz	ga3
ga9:	mvi	m,0
	ret

;	---- the data ----

;	---- the data ----

nomsg:	db	'No modem on this machine.',cr,lf,'$'
mcancel:db	'Given up.',0
mnoans:	db	'No answer.',0
mend:	db	'The end.',0
mtop:	db	'The top.',0
mnoback:db	'Nothing to go back to.',0
mnosuch:db	'No such link.',0
mnotgem:db	'Not a gemini link: GEMINI goes only there.',0
mbadad:	db	'Not an address: [gemini://]host[:port][/path]',0
mbadfn:	db	'Not a file name.',0
mdiskf:	db	'The disk is full, or will not take it.',0
msaved:	db	'Saved.',0
mdialg:	db	'Dialing ',0
mread:	db	'Reading ... ',0
mbytes:	db	' bytes (Esc stops)',0
mcert:	db	'The capsule asks for a client certificate: GEMINI has none.',0
pgo:	db	'Go to ([gemini://]host[:port][/path]): ',0
psave:	db	'Save as (d:name.typ): ',0
tfail:	db	'The call failed',0
tbad:	db	'Not a Gemini answer',0
terr:	db	'The capsule says no',0
tbin:	db	'Not text: GEMINI shows text only',0
tnoin:	db	'Nothing was given',0
tloop:	db	'Too many redirects',0
tnotgem:db	'A redirect away from Gemini',0
shead:	db	'# Gemini for CP/M',lf,lf,'A number and Return follows a link.',lf,lf,0
slink:	db	'=> ',0
defdir:	db	'gemini://geminiprotocol.net/ Project Gemini',lf,0
dirname:db	'GEMINI  DIR'
sproto:	db	'gemini://',0
sgemt:	db	'text/gemini',0
stext:	db	'text/',0
sslash:	db	'/',0
sqsp:	db	'? ',0
sbye:	db	27,'[r',27,'[0m',27,'[2J',27,'[H',0
scls:	db	27,'[r',27,'[0m',27,'[2J',27,'[H',0
sbar:	db	27,'[1;1H',27,'[7m GEMINI  ',0
sbarz:	db	27,'[K',27,'[0m',0
shome:	db	'home (GEMINI.DIR)',0
srow:	db	27,'[24;1H',27,'[K',0
srev:	db	27,'[7m',0
snorm:	db	27,'[0m  ',0
snorm0:	db	27,'[0m',0
sbold:	db	27,'[1m',0
skeys:	db	'# Ret  Spc next  B back  G go  ? help  Q quit> ',0
slnk:	db	' links  ',0
s5sp:	db	'     ',0
s4sp:	db	'    ',0
s2sp:	db	'  ',0
sbull:	db	'  * ',0
squot:	db	'  > ',0
sbs:	db	8,' ',8,0
scrlf:	db	cr,lf,0
sate0:	db	'ATE0',cr,0
sate1:	db	'ATE1',cr,0
nul:	db	0
rhead:	dw	0
rtail:	dw	0
t0:	dw	0
tlim:	dw	0
lptr:	dw	0
savesp:	dw	0
docbeg:	dw	doc
docend:	dw	0
bodyp:	dw	doc
dptr:	dw	0
count:	dw	0
nlines:	dw	0
top:	dw	0
ent:	dw	0
msg:	dw	0
wp:	dw	0
recp:	dw	0
dirp:	dw	0
lastsp:	dw	0
mode:	db	'g'
nlen:	db	0
hcnt:	db	0
rcnt:	db	0
room:	db	0
lead:	db	0
ipr:	dw	0		;the prompt of the line being typed
ihpos:	db	0		;the line of the history shown (0: the one being typed)
ihcnt:	db	0		;lines kept (nhst at most)
noh:	db	0		;1 while a file name is typed: not kept
ihist:	ds	nhst*80
;	?: the keys
hgem:	dw	hg0,hg1,hg2,hg3,hg4,hg5,hg6,hg7,hg8,hg9,hg10,hg11,hg12,0
hg0:	db	27,'[1m','GEMINI: the keys (any key goes back to the page)',27,'[0m',0
hg1:	db	'  a number, then Return: follow that link (or send a search)',0
hg2:	db	'  Space, N, or Return: the next page     P, -: the page before',0
hg3:	db	'  B, U: back to the place before (its page is read again)',0
hg4:	db	'  G: go to an address   Ctrl-P, Ctrl-N: the ones typed before',0
hg5:	db	'  H: home (GEMINI.DIR)      R: this page again',0
hg6:	db	'  W: save the page (its gemtext) to a file (d:name.typ)',0
hg7:	db	'  Esc: stop a page that is coming     Q: quit',0
hg8:	db	'  ?: this help',0
hg9:	db	0
hg10:	db	27,'[1m','THE ROWS',27,'[0m',0
hg11:	db	'  The top row: the capsule and where you are.',0
hg12:	db	'  The bottom row: [first-last/total] of this page, its links,','  the keys.',0
nlinks:	db	0
lnum:	db	0
pre:	db	0
wwid:	db	0
wkind:	db	0
wkind2:	db	0
pkind:	db	0
redirs:	db	0
clob:	db	0
nbuf:	ds	6
pbuf:	ds	8
dialbuf:db	'ATDT'
	ds	72
lbuf:	ds	80
cmdarg:	ds	72
ibuf:	ds	72
qbuf:	ds	72
meta:	ds	124
ubuf:	ds	256
tbuf:	ds	256
fcb:	ds	36
rec:	ds	128
cur:	ds	256
newl:	ds	256
	ds	256
stktop	equ	$
ring:	ds	1024
hist:	ds	2048
links:	ds	512
rowt:	ds	7500
doc	equ	$
	end
