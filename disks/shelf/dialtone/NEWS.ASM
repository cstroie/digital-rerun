;	NEWS: a Usenet (NNTP) reader for the modem port
;
;	A>NEWS			the home menu: the servers and groups of NEWS.DIR
;	A>NEWS host[:port][/group]	there at once (news:// or nntp:// may lead)
;
;	A group shows its last articles, the newest first, numbered: type the
;	number and Return to read one. Space and N the next page, P or - the one
;	before, O the older articles, B back, G go to an address, L the groups
;	of the server like a pattern (comp.os.*), H home, R again, W saves what
;	is shown to a file, Q quits, ? lists the keys. Esc stops a page that is
;	coming; at a prompt Ctrl-P and Ctrl-N bring back the last 10.
;	It only reads: nothing is posted. The call stays up from page to page;
;	a server that has hung up meanwhile is dialed again.
;
;	NEWS.DIR: a line each, host[:port][/group] and a name (no group: L asks).
;	Port 119 is plain TCP, passed raw; on 563 the bridge speaks TLS.
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
maxent	equ	1500		;lines of a page that can be shown
hmax	equ	8		;the way back: so many places
nhst	equ	10		;lines typed at a prompt kept for Ctrl-P
ospan	equ	rows		;articles of a group read at once (a screen: OVER lines are long)
;	a place: its type (H home, L groups, G a group, A an article), port, the first
;	row shown, a number (32 bits: the article; in a group the last one, 0 the newest),
;	the host, the group (or the pattern of L)
ltype	equ	0
lport	equ	1
ltop	equ	3
lnum	equ	8
lhost	equ	16
lsel	equ	80
lsize	equ	256

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
	sta	online
	lxi	h,0
	shld	msg
	lda	cmdarg
	ora	a
	jz	start1
	lxi	h,cmdarg
	lxi	d,cur
	call	paddr
	jc	start1
	lda	cur+ltype
	cpi	'L'
	jnz	start0
	lxi	d,cur		;a server alone: which groups
	call	askpat
	jc	start1
start0:	call	fetch
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
	cpi	'O'
	jz	volder
	cpi	'L'
	jz	vlist
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

;	a digit of the number of an item
vdigit:	mov	b,a
	lda	nlen
	cpi	4
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
	lxi	h,hnews
	call	hlines
	call	anykey
	jmp	vdraw

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

;	B: back the way we came
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
	call	fetch
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
	lxi	d,newl
	call	paddr
	lxi	h,mbadad
	jc	vmsg
	lda	newl+ltype
	cpi	'L'
	jnz	vgo1
	lxi	d,newl
	call	askpat
	jc	vprom
vgo1:	call	going		;(it goes on to the new page)

;	L: the groups of this server like a pattern
vlist:	xra	a
	sta	nlen
	lda	cur+ltype
	cpi	'H'
	lxi	h,mnoserv
	jz	vmsg
	call	newcur
	mvi	a,'L'
	sta	newl+ltype
	lxi	d,newl
	call	askpat
	jc	vprom
	call	going

;	O: the articles before the first one shown
volder:	xra	a
	sta	nlen
	lda	mode
	cpi	'G'
	lxi	h,mnotg
	jnz	vmsg
	lxi	h,glow
	lxi	d,gfirst
	call	cmp32
	lxi	h,moldest
	jnc	vmsg		;the first shown is the low mark (or below it)
	call	newcur
	lxi	h,gfirst
	lxi	d,newl+lnum
	call	mv32
	lxi	h,newl+lnum
	lxi	d,1
	call	sb32
	call	going

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
	call	fetch
	jnc	view
	shld	msg
	jmp	view		;what came (if anything) is shown

vquit:	lda	online
	ora	a
	jz	vq1
	in	mst
	ani	4
	jz	vq1
	lxi	h,squit		;a goodbye to the server
	call	txz
	lxi	h,500
	call	delay
vq1:	call	mfini
	lxi	h,sbye
	call	pz
exit:	lhld	savesp
	sphl
	ret
quitm:	mvi	c,print
	call	bdos
	jmp	exit

;	follow item HL (1 is the first line of the page)
follow:	mov	a,h
	ora	l
	jz	fnone
	dcx	h
	xchg
	lhld	nlines
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	jnc	fnone
	lda	mode
	cpi	'A'
	jz	fnone		;an article has no items
	xchg
	dad	h
	lxi	d,idxt
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	xchg			;HL = the line
	lda	mode
	cpi	'H'
	jz	flh
	cpi	'L'
	jz	fll
	call	rd32		;a group: the article numbered first on the line
	jc	fnone
	call	newcur
	lxi	h,acc
	lxi	d,newl+lnum
	call	mv32
	mvi	a,'A'
	sta	newl+ltype
	jmp	going
fnone:	lxi	h,mnosuch
	shld	msg
	ret
;	a line of the groups: its first word is the group
fll:	push	h
	call	newcur
	pop	h
	lxi	d,newl+lsel
	mvi	b,120
fl1:	mov	a,m
	cpi	21h
	jc	fl2
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	fl1
fl2:	xra	a
	stax	d
	mvi	a,'G'
	sta	newl+ltype
	lxi	h,newl+lnum
	call	z32
	jmp	going
;	a line of home: its address
flh:	lxi	d,newl
	call	paddr
	jc	fnone
	lda	newl+ltype
	cpi	'L'
	jnz	going
	lxi	d,newl
	call	askpat
	rc
;	NEWL is where to go: the way back keeps where we are
going:	lhld	top
	shld	cur+ltop
	call	hpush
	lxi	h,newl
	lxi	d,cur
	call	copyl
	lxi	h,0
	shld	cur+ltop
	call	fetch
	jnc	gn1
	shld	msg		;no: back where we were (the page is still there)
	call	hpop
gn1:	pop	h		;the caller's return: straight to the new page
	jmp	view

;	NEWL = CUR
newcur:	lxi	h,cur
	lxi	d,newl
	jmp	copyl

;	a pattern of groups typed into the place at DE: CY set if Esc or nothing
askpat:	push	d
	lxi	h,ppat
	call	input
	pop	d
	rc
	jz	apno
	lxi	h,lsel
	dad	d
	xchg
	lxi	h,ibuf
ap1:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	ap1
	ret			;(CY clear: ora)
apno:	stc
	ret


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

;	---- the server: a call that stays up, commands, answers ----

;	read the place CUR into the page: CY set and HL what went wrong if it failed.
;	A call kept from before may have been dropped by the server: then once again.
fetch:	lda	online
	sta	wason
	call	fet
	rnc
	lda	wason		;a new call failed: so be it
	ora	a
	stc
	rz
	lda	online		;the call is still up: the server said no
	ora	a
	stc
	rnz
	xra	a
	sta	wason
fet:	call	conn
	rc
	lda	cur+ltype
	cpi	'L'
	jnz	fe1
	lxi	h,slist		;LIST ACTIVE pattern
	lxi	d,cur+lsel
	call	cmd2
	rc
	mvi	a,'L'
	jmp	fbody
fe1:	lxi	h,sgroup	;GROUP name: 211 count low high name
	lxi	d,cur+lsel
	call	cmd2
	rc
	lxi	h,lbuf
	call	skipw
	call	skipw
	call	rd32
	push	h
	lxi	h,acc
	lxi	d,glow
	call	mv32
	pop	h
	call	skb
	call	rd32
	lxi	h,acc
	lxi	d,ghigh
	call	mv32
	lda	cur+ltype
	cpi	'A'
	jnz	fe2
	lxi	h,cur+lnum	;ARTICLE n
	lxi	d,acc
	call	mv32
	lxi	h,sart
	lxi	d,cbuf
	call	wstr
	call	wr32
	call	cmdgo
	rc
	mvi	a,'A'
	jmp	fbody
;	a group: the last article shown is the place's number (0: the newest), not
;	above the high mark; the first one OSPAN-1 before it, not below the low mark
fe2:	lxi	h,ghigh
	lxi	d,glast
	call	mv32
	lxi	h,cur+lnum
	call	nz32
	jz	fe3
	lxi	h,cur+lnum
	lxi	d,ghigh
	call	cmp32
	jnc	fe3
	lxi	h,cur+lnum
	lxi	d,glast
	call	mv32
fe3:	lxi	h,glast
	lxi	d,gfirst
	call	mv32
	lxi	h,gfirst
	lxi	d,ospan-1
	call	sb32
	jc	fe4
	lxi	h,gfirst
	lxi	d,glow
	call	cmp32
	jnc	fe5
fe4:	lxi	h,glow
	lxi	d,gfirst
	call	mv32
fe5:	lxi	h,glast		;high below low: nothing in it
	lxi	d,glow
	call	cmp32
	lxi	h,mempty
	rc
	lxi	h,sover		;OVER first-last; XOVER if the server knows no OVER
	call	range
	jnc	fe7
	lda	online
	ora	a
	stc
	rz
	lda	lbuf
	cpi	'5'
	stc
	rnz
	lxi	h,sxover
	call	range
	rc
fe7:	mvi	a,'G'
fbody:	sta	mode
	call	rbody
	ora	a
	ret

;	the command at HL, GFIRST-GLAST after it, sent; as CMDGO
range:	lxi	d,cbuf
	call	wstr
	push	d
	lxi	h,gfirst
	lxi	d,acc
	call	mv32
	pop	d
	call	wr32
	mvi	a,'-'
	stax	d
	inx	d
	push	d
	lxi	h,glast
	lxi	d,acc
	call	mv32
	pop	d
	call	wr32
	jmp	cmdgo

;	the command at HL, the text at DE after it, sent; as CMDGO
cmd2:	push	d
	lxi	d,cbuf
	call	wstr
	pop	h
	call	wstr
;	CBUF up to DE sent, CR LF, its answer read into LBUF: CY clear if it begins with 2;
;	else CY set and HL what went wrong
cmdgo:	xra	a
	stax	d
	lxi	h,cbuf
	call	txz
	lxi	h,scrlf
	call	txz
	call	rline
	rc
	cpi	'2'
	rz
	lxi	h,lbuf
	stc
	ret

;	HL past a word and the blanks after it
skipw:	mov	a,m
	cpi	21h
	jc	skb
	inx	h
	jmp	skipw
skb:	mov	a,m
	cpi	' '
	rnz
	inx	h
	jmp	skb

;	the call to the host and port of CUR: kept if it is up, else dialed, the greeting
;	read, MODE READER. CY set and HL what went wrong if it failed.
conn:	lda	online
	ora	a
	jz	cn1
	in	mst
	ani	4
	jz	cn1
	lxi	h,cur+lhost
	lxi	d,ohost
	call	streq
	jnz	cn0
	lhld	cur+lport
	xchg
	lhld	oport
	mov	a,l
	cmp	e
	jnz	cn0
	mov	a,h
	cmp	d
	jnz	cn0
	ora	a
	ret
cn0:	lxi	h,squit		;another server: this one is left
	call	txz
	call	drop
cn1:	xra	a
	sta	online
	sta	wason		;a new call: a failure of it is not tried again
	lhld	cur+lport	;the port in decimal after a colon
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
	call	rline		;200 or 201: it will talk
	rc
	cpi	'2'
	jnz	cnbad
	lxi	h,smode
	call	txz
	call	rline
	rc
	lxi	h,cur+lhost
	lxi	d,ohost
	mvi	b,64
	call	cl1
	lhld	cur+lport
	shld	oport
	mvi	a,1
	sta	online
	ora	a
	ret
cnbad:	call	drop
	lxi	h,lbuf
	stc
	ret

;	the 0-ended texts at HL and DE: Z set if they are the same
streq:	ldax	d
	cmp	m
	rnz
	ora	a
	rz
	inx	h
	inx	d
	jmp	streq

;	the call dropped
drop:	call	hangup
	xra	a
	sta	online
	ret

;	a line of the server into LBUF (0-ended, 76 at most): A its first character, CY
;	clear; CY set and HL what went wrong if the call went, Esc, or a minute of nothing
rline:	call	now
	shld	t0
	lxi	h,lbuf
	shld	lptr
rl1:	call	poll
	call	rget
	jnc	rl3
	in	mst
	ani	4
	jz	rlnc
	call	keyin
	cpi	1bh
	jz	rlesc
	call	elapsed
	lxi	d,60000
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jc	rl1
	call	drop
	lxi	h,mnoans
	stc
	ret
rl3:	cpi	cr
	jz	rl1
	cpi	lf
	jz	rl9
	lhld	lptr
	lxi	d,lbuf+76
	mov	b,a
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jnc	rl1		;too long: the rest is lost
	mov	m,b
	inx	h
	shld	lptr
	jmp	rl1
rl9:	lhld	lptr
	mvi	m,0
	lda	lbuf
	ora	a
	ret
rlnc:	xra	a
	sta	online
	lxi	h,mlost
	stc
	ret
rlesc:	call	drop
	xra	a
	sta	wason		;not dialed again
	lxi	h,mcancel
	stc
	ret

;	the lines of an answer into the page, up to the line of a dot alone (a dot that
;	begins a line goes). A full page takes no more, the rest is read; Esc, or a
;	minute of nothing, drops the call and keeps what came.
rbody:	call	rowmsg
	lxi	h,mread
	call	pz
	lhld	docbeg
	shld	dptr
	lxi	h,0
	shld	count
	xra	a
	sta	lstat
	sta	full
	call	now
	shld	t0
rb1:	call	poll
	call	rget
	jnc	rb2
	in	mst
	ani	4
	jz	rbnc
	call	keyin
	cpi	1bh
	jz	rbdrop
	call	elapsed
	lxi	d,60000
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jc	rb1
rbdrop:	call	drop
	jmp	rbend
rbnc:	xra	a
	sta	online
	jmp	rbend
rb2:	push	psw
	call	now
	shld	t0
	pop	psw
	mov	b,a
	cpi	cr
	jz	rb1
	cpi	lf
	jnz	rb3
	lda	lstat
	cpi	1
	jz	rbend		;the dot alone: the end
	xra	a
	sta	lstat
	mvi	a,lf
	jmp	rb5
rb3:	lda	lstat
	ora	a
	jnz	rb4
	mov	a,b
	cpi	'.'
	jnz	rb4
	mvi	a,1		;a dot first on the line: it goes
	sta	lstat
	jmp	rb1
rb4:	mvi	a,2
	sta	lstat
	mov	a,b
rb5:	mov	b,a
	lda	full
	ora	a
	jnz	rb1
	mov	a,b
	call	keep
	jnc	rb1
	mvi	a,1
	sta	full
	jmp	rb1
rbend:	lhld	dptr		;the page ends with a line end and a 0
	xchg
	lhld	docbeg
	mov	a,l
	cmp	e
	jnz	rbe1
	mov	a,h
	cmp	d
	jz	rbe2		;nothing came
rbe1:	xchg
	dcx	h
	mov	a,m
	inx	h
	cpi	lf
	jz	rbe3
	mvi	m,lf
	inx	h
	jmp	rbe3
rbe2:	xchg
rbe3:	mvi	m,0
	ora	a
	ret

;	---- numbers of 32 bits (the articles), the low byte first ----

;	HL at decimal digits: their value in ACC, HL after them; CY set if there are none
rd32:	push	h
	lxi	h,acc
	call	z32
	pop	h
	mvi	c,0
r1:	mov	a,m
	sui	'0'
	jc	r9
	cpi	10
	jnc	r9
	push	h
	push	b
	sta	dig
	lxi	h,acc		;ACC = (ACC * 4 + ACC) * 2 + the digit
	lxi	d,tmp32
	call	mv32
	lxi	h,acc
	call	sh32
	lxi	h,acc
	call	sh32
	lxi	h,acc
	lxi	d,tmp32
	call	ad32
	lxi	h,acc
	call	sh32
	lxi	h,tmp32
	call	z32
	lda	dig
	sta	tmp32
	lxi	h,acc
	lxi	d,tmp32
	call	ad32
	pop	b
	pop	h
	inx	h
	inr	c
	jmp	r1
r9:	mov	a,c
	ora	a
	stc
	rz
	cmc
	ret

;	ACC in decimal to DE (no 0 after it), DE after it; ACC is lost
wr32:	push	d
	lxi	h,dbuf+11
	mvi	m,0
w1:	push	h
	call	dv10
	pop	h
	dcx	h
	adi	'0'
	mov	m,a
	push	h
	lxi	h,acc
	call	nz32
	pop	h
	jnz	w1
	pop	d
w2:	mov	a,m
	ora	a
	rz
	stax	d
	inx	h
	inx	d
	jmp	w2

;	ACC divided by 10, the remainder in A
dv10:	lxi	h,acc+3
	mvi	c,4
	mvi	d,0
dv1:	mov	e,m		;DE = the remainder so far * 256 + this byte
	mvi	b,0
dv2:	mov	a,e
	sui	10
	mov	e,a
	mov	a,d
	sbi	0
	mov	d,a
	jc	dv3
	inr	b
	jmp	dv2
dv3:	mov	a,e
	adi	10
	mov	d,a
	mov	m,b
	dcx	h
	dcr	c
	jnz	dv1
	mov	a,d
	ret

;	the number at HL to DE
mv32:	mvi	c,4
mv1:	mov	a,m
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	mv1
	ret
;	the number at HL made 0
z32:	mvi	c,4
	xra	a
z1:	mov	m,a
	inx	h
	dcr	c
	jnz	z1
	ret
;	Z set if the number at HL is 0
nz32:	mvi	c,4
	xra	a
nz1:	ora	m
	inx	h
	dcr	c
	jnz	nz1
	ora	a
	ret
;	CY set if the number at HL is below the one at DE
cmp32:	mvi	c,4
	ora	a
cp1:	ldax	d
	mov	b,a
	mov	a,m
	sbb	b
	inx	h
	inx	d
	dcr	c
	jnz	cp1
	ret
;	the number at HL doubled
sh32:	mvi	c,4
	ora	a
sh1:	mov	a,m
	ral
	mov	m,a
	inx	h
	dcr	c
	jnz	sh1
	ret
;	the number at DE added to the one at HL
ad32:	mvi	c,4
	ora	a
ad1:	ldax	d
	adc	m
	mov	m,a
	inx	h
	inx	d
	dcr	c
	jnz	ad1
	ret
;	DE taken from the number at HL: CY set if it went below 0
sb32:	mov	a,m
	sub	e
	mov	m,a
	inx	h
	mov	a,m
	sbb	d
	mov	m,a
	inx	h
	mov	a,m
	sbi	0
	mov	m,a
	inx	h
	mov	a,m
	sbi	0
	mov	m,a
	ret

;	a byte from the host (A) into the page: CY set if the page is full
keep:	cpi	cr
	jz	kp9
	cpi	lf
	jz	kp1
	cpi	tab
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

;	---- the page: indexed, shown ----

;	the lines of the page into IDXT: an article's lines cut at 79 columns, of its
;	head only From, Subject, Date, Newsgroups; a group's the newest first
index:	call	idx
	lda	mode
	cpi	'G'
	rnz
	jmp	revidx
idx:	lxi	h,0
	shld	nlines
	lda	mode
	cpi	'A'
	mvi	a,0
	jnz	ix0
	inr	a
ix0:	sta	hdr
	lhld	docbeg
ix1:	mov	a,m
	ora	a
	rz
	lda	hdr
	ora	a
	jz	ix2
	mov	a,m
	cpi	lf
	jnz	ixh
	xra	a		;the empty line after the head: the body begins
	sta	hdr
	jmp	ix2
ixh:	call	hwant
	jz	ix2
	call	nextl		;a line of the head not shown
	jmp	ix1
ix2:	lda	mode
	cpi	'A'
	jz	ix2a
	mov	a,m		;an empty line of a list: nothing
	cpi	lf
	jnz	ix2a
	inx	h
	jmp	ix1
ix2a:	call	addent
	rc
	lda	mode
	cpi	'A'
	jz	ixt
	call	nextl
	jmp	ix1
ixt:	mvi	c,0		;the column
ixt1:	mov	a,m
	ora	a
	rz
	inx	h
	cpi	lf
	jz	ix1
	inr	c
	cpi	tab
	jnz	ixt2
	mov	a,c		;to the next column of eight
	dcr	a
	ori	7
	inr	a
	mov	c,a
ixt2:	mov	a,c
	cpi	79
	jc	ixt1
	mov	a,m		;79 columns: the rest is a line of its own
	cpi	lf
	jz	ixt1
	ora	a
	rz
	call	addent
	rc
	jmp	ixt

;	HL to the beginning of the next line (or to the 0 that ends the page)
nextl:	mov	a,m
	ora	a
	rz
	inx	h
	cpi	lf
	jnz	nextl
	ret

;	Z set if the line at HL is a header shown (HL kept)
hwant:	lxi	d,hnames
hw1:	ldax	d
	ora	a
	jz	hwno
	push	h
hw2:	ldax	d
	ora	a
	jz	hwyes
	mov	b,a
	mov	a,m
	call	lower
	cmp	b
	jnz	hw3
	inx	h
	inx	d
	jmp	hw2
hw3:	pop	h
hw4:	ldax	d		;past this name
	inx	d
	ora	a
	jnz	hw4
	jmp	hw1
hwyes:	pop	h
	ret			;(Z: the 0 of the name)
hwno:	inr	a
	ret

;	IDXT turned around: the last line first
revidx:	lhld	nlines
	mov	a,h
	ora	l
	rz
	dcx	h
	dad	h
	lxi	d,idxt
	dad	d
	xchg			;DE the last
	lxi	h,idxt		;HL the first
rv1:	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	rnc
	mov	c,m
	ldax	d
	mov	m,a
	mov	a,c
	stax	d
	inx	h
	inx	d
	mov	c,m
	ldax	d
	mov	m,a
	mov	a,c
	stax	d
	inx	h
	dcx	d
	dcx	d
	dcx	d
	jmp	rv1

;	the top row: NEWS, where we are
bar:	lxi	h,sbar
	call	pz
	mvi	a,70
	sta	room
	lda	cur+ltype
	cpi	'H'
	lxi	h,shome
	jz	ba9
	lxi	h,cur+lhost
	call	pzr
	lhld	cur+lport
	lxi	d,-119
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
ba1:	lxi	h,s2sp
	call	pzr
	lda	cur+ltype
	cpi	'L'
	jnz	ba2
	lxi	h,sgrps
	call	pzr
ba2:	lxi	h,cur+lsel
	call	pzr
	lda	cur+ltype
	cpi	'A'
	jnz	ba8
	lxi	h,shash
	call	pzr
	lxi	h,cur+lnum
	lxi	d,acc
	call	mv32
	lxi	d,pbuf
	call	wr32
	xra	a
	stax	d
	lxi	h,pbuf
ba9:	call	pzr
ba8:	lxi	h,sbarz
	jmp	pz

;	row HL of the page
prow:	dad	h
	lxi	d,idxt
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	xchg
	mvi	a,79
	sta	room
	lda	mode
	cpi	'A'
	jz	ptext
	push	h		;an item: its number, four wide
	lhld	ent
	inx	h
	call	pnum4
	mvi	a,75
	sta	room
	lxi	h,s2sp
	call	pzr
	pop	h
	lda	mode
	cpi	'L'
	jz	pword
	cpi	'H'
	jnz	prg
	push	h		;home: the name, after a tab
	call	field
	mov	a,m
	cpi	lf
	jz	prh1
	ora	a
	jz	prh1
	pop	d
	jmp	pname
prh1:	pop	h		;no name: the address
	jmp	pname
prg:	call	field		;a group: number, subject, from
	push	h
	call	field
	call	pfrom
	pop	h
	jmp	pname

;	the word at HL (up to a blank)
pword:	mov	a,m
	cpi	21h
	rc
	call	cr1
	inx	h
	jmp	pword

;	who wrote it, in 18 columns: the name if there is one (no quotes, no address)
pfrom:	mvi	b,18
pf0:	mov	a,m
	cpi	'"'
	jnz	pf1
	inx	h
	jmp	pf0
pf1:	mov	a,m
	cpi	tab
	jz	pf8
	cpi	lf
	jz	pf8
	ora	a
	jz	pf8
	cpi	'"'
	jz	pf8
	cpi	'<'
	jnz	pf2
	mov	a,b
	cpi	18
	jnz	pf8		;a name before it: enough
	mov	a,m
pf2:	call	cr1
	inx	h
	dcr	b
	jnz	pf1
pf8:	mov	a,b
	ora	a
	jz	pf9
	mvi	a,' '
	call	cr1
	dcr	b
	jmp	pf8
pf9:	mvi	a,' '
	jmp	cr1

;	HL in a line: past the next tab (or at the end of the line)
field:	mov	a,m
	cpi	lf
	rz
	ora	a
	rz
	inx	h
	cpi	tab
	rz
	jmp	field

;	---- the home menu: NEWS.DIR, a line each: the address, a tab, the name ----

home:	mvi	a,'H'
	sta	cur+ltype
	sta	mode
	lxi	h,0
	shld	cur+ltop
	lhld	docend		;the file is read into the last 4K of the room
	lxi	d,-4096
	dad	d
	shld	dirp
	call	loaddir
	jnc	hm0
	lhld	dirp		;no NEWS.DIR: one server
	xchg
	lxi	h,defdir
hm00:	mov	a,m
	stax	d
	inx	h
	inx	d
	ora	a
	jnz	hm00
hm0:	lhld	docbeg
	xchg
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
hm2:	mvi	b,120
hm2a:	mov	a,m		;the address
	cpi	21h
	jc	hm3
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	hm2a
hm3:	mvi	a,tab
	stax	d
	inx	d
hm3b:	mov	a,m
	cpi	' '
	jz	hm3a
	cpi	tab
	jnz	hm4
hm3a:	inx	h
	jmp	hm3b
hm4:	mvi	b,70
hm5:	mov	a,m		;the name, up to the end of the line
	cpi	20h
	jc	hm6
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	hm5
hm6:	mvi	a,lf
	stax	d
	inx	d
hm8:	mov	a,m		;to the next line of the file
	ora	a
	jz	hm9
	cpi	1ah
	jz	hm9
	inx	h
	cpi	lf
	jnz	hm8
	jmp	hm1
hm9:	xra	a
	stax	d
	ret

;	an address at HL (news:// or nntp:// may lead), host[:port][/group], into the
;	place at DE: port 119 if not given; type G with a group, L without (the pattern
;	asked after); HL after it. CY set if there is no host.
paddr:	xchg
	shld	lp
	xchg
	lxi	d,sproto1
	call	skip
	lxi	d,sproto2
	call	skip
	push	h
	lhld	lp
	mvi	m,'L'		;the type
	inx	h
	mvi	m,119		;the port
	inx	h
	mvi	m,0
	lhld	lp
	lxi	b,lnum
	dad	b
	call	z32
	lhld	lp
	lxi	b,lsel
	dad	b
	mvi	m,0		;no group
	lhld	lp
	lxi	b,lhost
	dad	b
	xchg			;DE the host
	pop	h		;HL the text
	mvi	b,63
pa1:	mov	a,m
	cpi	21h
	jc	pa2
	cpi	':'
	jz	pa2
	cpi	'/'
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
	mov	a,m
	cpi	':'
	jnz	pa3
	inx	h
	call	rdnum
	jc	pa3
	push	h
	lhld	lp
	inx	h
	mov	m,e
	inx	h
	mov	m,d
	pop	h
pa3:	mov	a,m
	cpi	'/'
	jnz	pa9
	inx	h
	push	h
	lhld	lp
	lxi	b,lsel
	dad	b
	xchg
	pop	h
	mvi	b,120
pa4:	mov	a,m		;the group, as it is
	cpi	21h
	jc	pa5
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	pa4
pa5:	xra	a
	stax	d
	push	h
	lhld	lp
	lxi	b,lsel
	dad	b
	mov	a,m
	ora	a
	jz	pa6
	lhld	lp
	mvi	m,'G'
pa6:	pop	h
pa9:	ora	a
	ret

;	HL past the text at DE if it begins with it (in any case); else HL kept
skip:	push	h
sk1:	ldax	d
	ora	a
	jz	sk9
	mov	b,a
	mov	a,m
	call	lower
	cmp	b
	jnz	sk8
	inx	h
	inx	d
	jmp	sk1
sk8:	pop	h
	ret
sk9:	pop	d		;(thrown away)
	ret

;	HL into the next place of IDXT (HL kept); CY set if it is full
addent:	push	h
	lhld	nlines
	lxi	d,maxent
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	cmc
	jc	ad9
	push	h
	inx	h
	shld	nlines
	pop	h
	dad	h
	lxi	d,idxt
	dad	d
	pop	d
	mov	m,e
	inx	h
	mov	m,d
	xchg
	ora	a
	ret
ad9:	pop	h
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

;	the name of a menu line: up to its tab
pname:	mov	a,m
	cpi	tab
	rz
	cpi	lf
	rz
	ora	a
	rz
	call	cr1
	inx	h
	jmp	pname
;	a line of a text: tabs to columns of eight, 79 columns at most
ptext:	mvi	c,0
pt1:	mov	a,m
	cpi	lf
	rz
	ora	a
	rz
	inx	h
	cpi	tab
	jz	pt3
	inr	c
	call	cout
pt2:	mov	a,c
	cpi	79
	jc	pt1
	ret
pt3:	mvi	a,' '
	call	cout
	inr	c
	mov	a,c
	ani	7
	jz	pt2
	mov	a,c
	cpi	79
	jc	pt3
	ret

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

;	read NEWS.DIR to DIRP (^Z ends it); CY set if there is none
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
	lhld	docbeg
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

nomsg:	db	'No modem on this machine.',cr,lf,'$'
mcancel:db	'Given up.',0
mnoans:	db	'No answer.',0
mlost:	db	'The server hung up.',0
mend:	db	'The end.',0
mtop:	db	'The top.',0
mnoback:db	'Nothing to go back to.',0
mnosuch:db	'No such item.',0
mbadad:	db	'Not an address: host[:port][/group]',0
mbadfn:	db	'Not a file name.',0
mdiskf:	db	'The disk is full, or will not take it.',0
msaved:	db	'Saved.',0
mempty:	db	'No articles in that group.',0
moldest:db	'These are the oldest.',0
mnotg:	db	'O is for a group.',0
mnoserv:db	'Which server? G, or a line here first.',0
mdialg:	db	'Dialing ',0
mread:	db	'Reading ... ',0
mbytes:	db	' bytes (Esc stops)',0
pgo:	db	'Go to (host[:port][/group]): ',0
ppat:	db	'Groups like (comp.os.*): ',0
psave:	db	'Save as (d:name.typ): ',0
sgroup:	db	'GROUP ',0
sart:	db	'ARTICLE ',0
sover:	db	'OVER ',0
sxover:	db	'XOVER ',0
slist:	db	'LIST ACTIVE ',0
smode:	db	'MODE READER',cr,lf,0
squit:	db	'QUIT',cr,lf,0
hnames:	db	'from:',0,'subject:',0,'date:',0,'newsgroups:',0,0
defdir:	db	'freenews.netfront.net/comp.os.cpm comp.os.cpm',lf,0
dirname:db	'NEWS    DIR'
sproto1:db	'news://',0
sproto2:db	'nntp://',0
sbye:	db	27,'[r',27,'[0m',27,'[2J',27,'[H',0
scls:	db	27,'[r',27,'[0m',27,'[2J',27,'[H',0
sbar:	db	27,'[1;1H',27,'[7m NEWS  ',0
sbarz:	db	27,'[K',27,'[0m',0
shome:	db	'home (NEWS.DIR)',0
sgrps:	db	'groups like ',0
shash:	db	'  #',0
srow:	db	27,'[24;1H',27,'[K',0
srev:	db	27,'[7m',0
snorm:	db	27,'[0m  ',0
skeys:	db	'] # Ret  Spc  O older  B back  L groups  ? help  Q> ',0
s2sp:	db	'  ',0
sbs:	db	8,' ',8,0
scrlf:	db	cr,lf,0
sate0:	db	'ATE0',cr,0
sate1:	db	'ATE1',cr,0
rhead:	dw	0
rtail:	dw	0
t0:	dw	0
tlim:	dw	0
lptr:	dw	0
savesp:	dw	0
docbeg:	dw	doc
docend:	dw	0
dptr:	dw	0
count:	dw	0
nlines:	dw	0
top:	dw	0
ent:	dw	0
msg:	dw	0
lp:	dw	0
wp:	dw	0
recp:	dw	0
dirp:	dw	0
oport:	dw	0		;the port of the call that is up
mode:	db	'H'
nlen:	db	0
online:	db	0		;1 while a call to a server is up
wason:	db	0		;1 if the page asked for began on a call kept
hdr:	db	0		;1 in the head of an article
lstat:	db	0		;of a line coming: 0 its beginning, 1 after a dot first, 2 more
full:	db	0		;1 when the page is full: the rest of the answer read, not kept
dig:	db	0
ipr:	dw	0		;the prompt of the line being typed
ihpos:	db	0		;the line of the history shown (0: the one being typed)
ihcnt:	db	0		;lines kept (nhst at most)
noh:	db	0		;1 while a file name is typed: not kept
ihist:	ds	nhst*80
;	?: the keys
hnews:	dw	hn0,hn1,hn2,hn3,hn4,hn5,hn6,hn7,hn8,hn9,hn10,hn11,hn12,hn13,hn14,0
hn0:	db	27,'[1m','NEWS: the keys (any key goes back to the page)',27,'[0m',0
hn1:	db	'  a number, then Return: read that article, open that group',0
hn2:	db	'  Space, N, or Return: the next page     P, -: the page before',0
hn3:	db	'  O: the older articles of the group',0
hn4:	db	'  B, U: back to the place before (its page is read again)',0
hn5:	db	'  G: go to an address   Ctrl-P, Ctrl-N: the ones typed before',0
hn6:	db	'  L: the groups of this server like a pattern (comp.os.*)',0
hn7:	db	'  H: home (NEWS.DIR)      R: this page again',0
hn8:	db	'  W: save the page as CP/M text (d:name.typ), the whole head',0
hn9:	db	'  Esc: stop a page that is coming     Q: quit',0
hn10:	db	'  ?: this help',0
hn11:	db	0
hn12:	db	27,'[1m','THE ROWS',27,'[0m',0
hn13:	db	'  The top row: the server, the group, the article.',0
hn14:	db	'  The bottom row: [first-last/total] of this page, the keys.',0
hcnt:	db	0
rcnt:	db	0
room:	db	0
lead:	db	0
nbuf:	ds	6
pbuf:	ds	12
dbuf:	ds	12
acc:	ds	4
tmp32:	ds	4
glow:	ds	4		;the group: its low and high marks, the first and last shown
ghigh:	ds	4
gfirst:	ds	4
glast:	ds	4
dialbuf:db	'ATDT'
	ds	72
lbuf:	ds	80
cmdarg:	ds	72
ibuf:	ds	72
cbuf:	ds	144
ohost:	ds	64		;the host of the call that is up
fcb:	ds	36
rec:	ds	128
cur:	ds	256
newl:	ds	256
	ds	256
stktop	equ	$
ring:	ds	1024
hist:	ds	2048
idxt:	ds	3000
doc	equ	$
	end
