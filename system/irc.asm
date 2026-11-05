;	IRC: an IRC client for the modem port
;
;	It speaks IRC over the modem (ports 6 and 7), the way TERM speaks to a BBS:
;	dial a server with ATDT (a host and a port, through the bridge), then talk.
;	The screen is a VT100: a status bar on the top row, the messages scrolling
;	in a region below it, and your line on the bottom row.
;
;	What you type is a command when it starts with a slash, and is said to the
;	current channel (or person) when it does not:
;
;	  /connect [host[:port] | n]   dial a server; no argument lists IRC.DIR
;	  /nick name   /join #chan   /part [#chan]   /list [args]   /names [#chan]
;	  /msg nick text   /query nick   /me action   /whois nick   /who mask
;	  /topic [text]   /mode ...   /away [text]   /raw line
;	  /quit [text]  hangs up,  /bye [text]  hangs up and leaves,  /help,  /clear
;
;	IRC.DIR holds the servers, one per line: host[:port] and a name. Plain
;	TCP only: the bridge does no TLS, so a server must listen on 6667 or so.
;	B>IRC		(it lives on the Online shelf disk, with TERM)
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
conio	equ	6		;direct console I/O: E = 0FFh reads a key (A = 0: none)
print	equ	9
openf	equ	15
readsq	equ	20
setdma	equ	26
clk	equ	20		;the clock port: OUT latches, IN reads the record
mst	equ	6		;modem status: bit 0 byte waiting, bit 1 may send, bit 2 carrier
mctl	equ	6		;modem control: bit 0 DTR
mdat	equ	7		;modem data
cr	equ	13
lf	equ	10
imax	equ	76		;the longest line you can type (the bottom row)

	org	100h
	in	mst
	cpi	0ffh		;nothing answers: no modem here
	jnz	have
	lxi	d,nomsg
	mvi	c,print
	call	bdos
	ret
have:	lxi	h,0
	dad	sp
	shld	savesp
	lxi	sp,stktop
	mvi	a,1		;DTR up
	out	mctl
	xra	a
	sta	rhead
	sta	rtail
	sta	dcd		;the first look at the carrier tells if a call is up
	sta	dialing
	sta	reg
	sta	ilen
	sta	ibuf
	sta	target
	sta	srvname
	lxi	h,lbuf
	shld	lptr
	call	initnick
	in	mst
	ani	4
	jnz	hv1
	lxi	h,sate0		;no call: the modem need not echo what we send it
	call	txz
hv1:	call	initscr
	lxi	h,mhello
	call	info
	lxi	h,mhello2
	call	info
	jmp	loop

;	the loop: the modem into the ring, the carrier, a byte of the ring, a key
loop:	call	poll
	in	mst
	ani	4
	lxi	h,dcd
	cmp	m
	jnz	carr
	call	rget
	jc	getkey
	call	feed
	jmp	loop
getkey:	mvi	e,0ffh
	mvi	c,conio
	call	bdos
	ora	a
	jz	loop
	call	key
	jmp	loop

;	the carrier changed (A = 0 or 4 now)
carr:	sta	dcd
	ora	a
	jz	cdown
	xra	a
	sta	dialing
	lxi	h,mconn
	call	info
	call	register
	jmp	cstat
cdown:	xra	a
	sta	reg
	sta	dialing
	lxi	h,mdisc
	call	info
cstat:	call	drawstat
	jmp	loop

;	---- the modem: a ring of what came, and the way out ----

;	move what the modem has into the ring (all registers kept)
poll:	push	psw
	push	b
	push	h
pl1:	in	mst
	ani	1
	jz	pl9
	lda	rhead
	mov	b,a		;B = head
	inr	a		;A = head + 1
	lxi	h,rtail
	cmp	m		;the ring is full when head + 1 is the tail
	jz	pl9
	sta	rhead
	in	mdat
	mov	c,a
	mov	l,b
	mvi	h,high ring
	mov	m,c
	jmp	pl1
pl9:	pop	h
	pop	b
	pop	psw
	ret

;	a byte of the ring into A; CY set if it is empty (H and L kept)
rget:	push	h
	lda	rtail
	lxi	h,rhead
	cmp	m
	jnz	rg1
	pop	h
	stc
	ret
rg1:	mov	l,a
	inr	a
	sta	rtail
	mvi	h,high ring
	mov	a,m
	pop	h
	ora	a		;CY clear
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

;	the low 16 bits of the clock's milliseconds into HL
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

;	wait HL milliseconds, the modem looked at meanwhile
delay:	push	h
	call	now
	shld	t0
	pop	h
	shld	tlim
dl1:	call	poll
	call	now
	xchg			;DE = now
	lhld	t0
	mov	a,e
	sub	l
	mov	l,a
	mov	a,d
	sbb	h
	mov	h,a
	xchg			;DE = elapsed
	lhld	tlim
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	jc	dl1
	ret

;	DTR down and up again: the call is dropped
hangup:	xra	a
	sta	dialing
	sta	reg
	out	mctl
	lxi	h,50
	call	delay
	mvi	a,1
	out	mctl
	ret

;	---- the screen ----

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

;	the message area: a line begins at its bottom row (the region scrolls) and ends
;	with the cursor back where you were typing
mbeg:	lxi	h,mbs
	call	pz
	xra	a
	sta	mcol
	ret
mend:	lxi	h,mes
	jmp	pz

;	a character in the message area; the line wraps before the last column
mputc:	push	psw
	lda	mcol
	cpi	79
	jc	mp1
	mvi	a,cr
	call	cout
	mvi	a,lf
	call	cout
	xra	a
	sta	mcol
	pop	psw
	cpi	' '		;a blank at the start of a wrapped line is dropped
	rz
	push	psw
mp1:	lda	mcol
	inr	a
	sta	mcol
	pop	psw
	jmp	cout

;	the 0-ended text at HL in the message area
mputz:	mov	a,m
	ora	a
	rz
	inx	h
	call	mputc
	jmp	mputz

;	A (0-99) in decimal in the message area, two columns wide
mputn:	mvi	b,'0'
mn1:	cpi	10
	jc	mn2
	sui	10
	inr	b
	jmp	mn1
mn2:	adi	'0'
	push	psw
	mov	a,b
	cpi	'0'
	jnz	mn3
	mvi	a,' '
mn3:	call	mputc
	pop	psw
	jmp	mputc

;	a line of our own in the message area: *** and the text at HL
info:	push	h
	call	mbeg
	lxi	h,sstar
	call	mputz
	pop	h
	call	mputz
	jmp	mend

;	the whole screen: status bar, message region, your line
initscr:lxi	h,sinit
	call	pz
	call	drawstat
	jmp	drawin
drawin:	lxi	h,sprompt
	call	pz
	lxi	h,ibuf
	jmp	pz

;	the status bar (the cursor is kept where it was)
drawstat:
	lxi	h,sst1
	call	pz
	lxi	h,mynick
	call	pz
	lda	dcd
	ora	a
	jnz	ds1
	lda	dialing
	ora	a
	lxi	h,sdial
	jnz	ds2
	lxi	h,snot
	jmp	ds2
ds1:	lxi	h,son
ds2:	call	pz
	lda	dcd
	ora	a
	jnz	ds3
	lda	dialing
	ora	a
	jz	ds4
ds3:	lxi	h,srvname
	call	pz
ds4:	lxi	h,sto
	call	pz
	lda	target
	ora	a
	lxi	h,target
	jnz	ds5
	lxi	h,snone
ds5:	call	pz
	lxi	h,sst2
	jmp	pz

;	---- strings ----

;	HL = a string: CY clear if it equals the one at DE (case does not matter): Z set
scmp:	mov	a,m
	call	upper
	mov	b,a
	ldax	d
	call	upper
	cmp	b
	rnz
	ora	a
	rz
	inx	h
	inx	d
	jmp	scmp

upper:	cpi	'a'
	rc
	cpi	'{'
	rnc
	sui	20h
	ret

;	upper-case the 0-ended text at HL
upcase:	call	poll
	mov	a,m
	ora	a
	rz
	call	upper
	mov	m,a
	inx	h
	jmp	upcase

;	copy the text at HL to DE, 30 characters at most, and a 0
copyn:	mvi	b,30
cp1:	mov	a,m
	ora	a
	jz	cp2
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	cp1
cp2:	xra	a
	stax	d
	ret

;	CY set if A is the first character of a channel name
ischan:	cpi	'#'
	jz	ic1
	cpi	'&'
	jz	ic1
	ora	a
	ret
ic1:	stc
	ret

;	CY set if A is a digit
isdig:	cpi	'0'
	jc	idn
	cpi	'9'+1
	jnc	idn
	stc
	ret
idn:	ora	a
	ret

;	HL is the text (NUL ended) to be sought in; DE the prefix: Z set if HL begins with it, HL after it
starts:	ldax	d
	ora	a
	rz
	cmp	m
	rnz
	inx	h
	inx	d
	jmp	starts

;	a word at HL: it ends at the first blank (made a 0), the blanks after it are skipped; HL is the next word
word:	call	poll
	mov	a,m
	ora	a
	rz
	cpi	' '
	jz	wd1
	inx	h
	jmp	word
wd1:	mvi	m,0
	inx	h
wd2:	mov	a,m
	cpi	' '
	rnz
	inx	h
	jmp	wd2

;	HL = a word, 1 or 2 digits and no more: its value (1-99) in A, CY clear; else CY set
isidx:	mov	a,m
	call	isdig
	jnc	nix
	sui	'0'
	mov	b,a
	inx	h
	mov	a,m
	ora	a
	jz	ix9
	call	isdig
	jnc	nix
	sui	'0'
	mov	c,a
	mov	a,b
	add	a
	mov	b,a
	add	a
	add	a
	add	b
	add	c
	mov	b,a
	inx	h
	mov	a,m
	ora	a
	jnz	nix
ix9:	mov	a,b
	ora	a
	jz	nix
	ora	a
	ret
nix:	stc
	ret

;	BC = a word, DE = a table of 0-ended names each followed by the address of its routine,
;	the table ended by a 0: HL = the routine, CY clear; or CY set
lookup:	call	poll
	ldax	d
	ora	a
	jz	lkn
	push	b
lk2:	ldax	b
	mov	h,a
	ldax	d
	cmp	h
	jnz	lk3
	ora	a
	jz	lkm
	inx	b
	inx	d
	jmp	lk2
lk3:	ldax	d
	inx	d
	ora	a
	jnz	lk3
	inx	d
	inx	d
	pop	b
	jmp	lookup
lkm:	inx	d
	xchg
	mov	e,m
	inx	h
	mov	d,m
	xchg
	pop	b
	ora	a
	ret
lkn:	stc
	ret

;	---- what you type ----

;	a key (in A)
key:	cpi	cr
	jz	enter
	cpi	8
	jz	bksp
	cpi	7fh
	jz	bksp
	cpi	15h
	jz	kill
	cpi	18h
	jz	kill
	cpi	20h
	rc
	cpi	7fh
	rnc
	mov	b,a
	lda	ilen
	cpi	imax
	rnc
	mov	e,a
	mvi	d,0
	inr	a
	sta	ilen
	lxi	h,ibuf
	dad	d
	mov	m,b
	inx	h
	mvi	m,0
	mov	a,b
	jmp	cout
bksp:	lda	ilen
	ora	a
	rz
	dcr	a
	sta	ilen
	mov	e,a
	mvi	d,0
	lxi	h,ibuf
	dad	d
	mvi	m,0
	lxi	h,sbs
	jmp	pz
kill:	xra	a
	sta	ilen
	sta	ibuf
	lxi	h,sclrin
	jmp	pz
enter:	lda	ilen
	ora	a
	rz
	lda	ibuf
	cpi	'/'
	jnz	en1
	lda	ibuf+1
	cpi	'/'		;// : a line that begins with a slash
	jz	en2
	call	docmd
	jmp	en9
en1:	lxi	h,ibuf
	jmp	en3
en2:	lxi	h,ibuf+1
en3:	call	saytext
en9:	xra	a
	sta	ilen
	sta	ibuf
	lxi	h,sclrin
	jmp	pz

;	CY set (and a word said) if there is no connection
needc:	lda	dcd
	ora	a
	jz	nc1
	ora	a
	ret
nc1:	lxi	h,mnocon
	call	info
	stc
	ret

;	say the text at HL to the current target
saytext:shld	argp
	call	needc
	rc
	lda	target
	ora	a
	jnz	sy1
	lxi	h,mnotgt
	jmp	info
sy1:	lxi	h,target
	shld	w1
	jmp	sendpm

;	PRIVMSG to the name at W1 with the text at ARGP; and show it
sendpm:	call	bnew
	lxi	h,sprivmsg
	call	bstr
	lhld	w1
	call	bstr
	lxi	h,scoln
	call	bstr
	lhld	argp
	call	bstr
	call	bsend
	call	mbeg
	lhld	w1
	lxi	d,target
	call	scmp
	jnz	sp1
	mvi	a,'<'
	call	mputc
	lxi	h,mynick
	call	mputz
	lxi	h,sclose
	call	mputz
	jmp	sp2
sp1:	lxi	h,sarrow2
	call	mputz
	lhld	w1
	call	mputz
	lxi	h,scolon
	call	mputz
sp2:	lhld	argp
	call	mputz
	jmp	mend

;	the line to send to the server is built in OBUF
bnew:	push	h
	lxi	h,obuf
	shld	optr
	pop	h
	ret
badd:	push	h
	lhld	optr
	mov	m,a
	inx	h
	shld	optr
	pop	h
	ret
bstr:	mov	a,m
	ora	a
	rz
	inx	h
	call	badd
	jmp	bstr
bsend:	mvi	a,cr
	call	badd
	mvi	a,lf
	call	badd
	xra	a
	call	badd
	lxi	h,obuf
	jmp	txz

;	the next word of the arguments: HL
aword:	lhld	argp
	push	h
	call	word
	shld	argp
	pop	h
	ret

;	a slash command: the line is in IBUF
docmd:	lxi	h,ibuf+1
	push	h
dc1:	mov	a,m
	ora	a
	jz	dc2
	cpi	' '
	jz	dc3
	inx	h
	jmp	dc1
dc3:	mvi	m,0
	inx	h
dc4:	mov	a,m
	cpi	' '
	jnz	dc2
	inx	h
	jmp	dc4
dc2:	shld	argp
	pop	h
	push	h
	call	upcase
	pop	b
	lxi	d,cmdtab
	call	lookup
	jc	badcmd
	pchl
badcmd:	lxi	h,mbad
	jmp	info
usage:	lxi	h,musage
	jmp	info

;	the commands
cmdtab:	db	'CONNECT',0
	dw	cconn
	db	'SERVER',0
	dw	cconn
	db	'NICK',0
	dw	cnick
	db	'JOIN',0
	dw	cjoin
	db	'J',0
	dw	cjoin
	db	'PART',0
	dw	cpart
	db	'LEAVE',0
	dw	cpart
	db	'LIST',0
	dw	clist
	db	'NAMES',0
	dw	cnames
	db	'MSG',0
	dw	cmsg
	db	'QUERY',0
	dw	cquery
	db	'ME',0
	dw	cme
	db	'WHOIS',0
	dw	cwhois
	db	'WHO',0
	dw	cwho
	db	'TOPIC',0
	dw	ctopic
	db	'MODE',0
	dw	cmode
	db	'AWAY',0
	dw	caway
	db	'RAW',0
	dw	craw
	db	'QUOTE',0
	dw	craw
	db	'QUIT',0
	dw	cquit
	db	'BYE',0
	dw	cbye
	db	'EXIT',0
	dw	cbye
	db	'HELP',0
	dw	chelp
	db	'CLEAR',0
	dw	cclear
	db	0

;	/help
chelp:	lxi	h,hlp1
	call	info
	lxi	h,hlp2
	call	info
	lxi	h,hlp3
	call	info
	lxi	h,hlp4
	call	info
	lxi	h,hlp5
	call	info
	lxi	h,hlp6
	jmp	info
cclear:	jmp	initscr

;	/nick name
cnick:	call	aword
	mov	a,m
	ora	a
	jnz	cn1
	lxi	h,mynick	;no name: say what it is
	jmp	info
cn1:	shld	w1
	lda	dcd
	ora	a
	jz	cn3
	call	bnew
	lxi	h,scnick
	call	bstr
	lhld	w1
	call	bstr
	call	bsend
	lda	reg
	ora	a
	rnz			;registered: the server's NICK message makes it ours
cn3:	lhld	w1
	lxi	d,mynick
	call	copyn
	jmp	drawstat

;	/join #chan [key]
cjoin:	call	needc
	rc
	call	aword
	shld	w1
	mov	a,m
	ora	a
	jz	usage
	call	bnew
	lxi	h,sjoin
	call	bstr
	lhld	w1
	mov	a,m
	call	ischan
	jc	cj1
	mvi	a,'#'
	call	badd
cj1:	lhld	w1
	call	bstr
	lhld	argp
	mov	a,m
	ora	a
	jz	cj2
	mvi	a,' '
	call	badd
	lhld	argp
	call	bstr
cj2:	call	bsend
	lhld	w1
	mov	a,m
	call	ischan
	jc	cj3
	lxi	d,target
	mvi	a,'#'
	stax	d
	inx	d
	lhld	w1
	call	copyn
	jmp	drawstat
cj3:	lhld	w1
	lxi	d,target
	call	copyn
	jmp	drawstat

;	/part [#chan]
cpart:	call	needc
	rc
	call	aword
	mov	a,m
	ora	a
	jnz	cpt1
	lxi	h,target
cpt1:	mov	a,m
	ora	a
	jz	usage
	shld	w1
	call	bnew
	lxi	h,spart
	call	bstr
	lhld	w1
	call	bstr
	call	bsend
	lhld	w1
	lxi	d,target
	call	scmp
	rnz
	xra	a
	sta	target
	jmp	drawstat

;	/list [args], /names [#chan], /whois nick, /who mask, /away [text]: a verb and the rest
clist:	call	needc
	rc
	lxi	h,vlist
	jmp	sverb
cwhois:	call	needc
	rc
	lxi	h,vwhois
	jmp	sverb
cwho:	call	needc
	rc
	lxi	h,vwho
	jmp	sverb
caway:	call	needc
	rc
	lxi	h,vaway
	jmp	sverb
cnames:	call	needc
	rc
	lhld	argp
	mov	a,m
	ora	a
	jnz	cnm1
	lda	target		;no channel named: the current one
	call	ischan
	jnc	cnm1
	lxi	h,target
	shld	argp
cnm1:	lxi	h,vnames
sverb:	push	h
	call	bnew
	pop	h
	call	bstr
	lhld	argp
	mov	a,m
	ora	a
	jz	sv1
	mvi	a,' '
	call	badd
	lhld	argp
	call	bstr
sv1:	jmp	bsend
craw:	call	needc
	rc
	lhld	argp
	mov	a,m
	ora	a
	jz	usage
	call	bnew
	lhld	argp
	call	bstr
	jmp	bsend

;	/topic [text]
ctopic:	call	needc
	rc
	lda	target
	ora	a
	jz	cto9
	call	bnew
	lxi	h,vtopic
	call	bstr
	lxi	h,target
	call	bstr
	lhld	argp
	mov	a,m
	ora	a
	jz	cto1
	lxi	h,scoln
	call	bstr
	lhld	argp
	call	bstr
cto1:	jmp	bsend
cto9:	lxi	h,mnotgt
	jmp	info

;	/mode [target] +x: the target is the current one if the first word begins with + or -
cmode:	call	needc
	rc
	lhld	argp
	mov	a,m
	ora	a
	jz	usage
	call	bnew
	lxi	h,vmode
	call	bstr
	lhld	argp
	mov	a,m
	cpi	'+'
	jz	cmo1
	cpi	'-'
	jnz	cmo2
cmo1:	lda	target
	ora	a
	jz	cto9
	lxi	h,target
	call	bstr
	mvi	a,' '
	call	badd
cmo2:	lhld	argp
	call	bstr
	jmp	bsend

;	/msg nick text
cmsg:	call	needc
	rc
	call	aword
	shld	w1
	mov	a,m
	ora	a
	jz	usage
	lhld	argp
	mov	a,m
	ora	a
	jz	usage
	jmp	sendpm

;	/query nick [text]
cquery:	call	aword
	mov	a,m
	ora	a
	jz	usage
	shld	w1
	lxi	d,target
	call	copyn
	call	drawstat
	lhld	argp
	mov	a,m
	ora	a
	rz
	call	needc
	rc
	lxi	h,target
	shld	w1
	jmp	sendpm

;	/me action
cme:	call	needc
	rc
	lda	target
	ora	a
	jz	cto9
	lhld	argp
	mov	a,m
	ora	a
	jz	usage
	call	bnew
	lxi	h,sprivmsg
	call	bstr
	lxi	h,target
	call	bstr
	lxi	h,sactp
	call	bstr
	lhld	argp
	call	bstr
	mvi	a,1
	call	badd
	call	bsend
	call	mbeg
	lxi	h,sstar1
	call	mputz
	lxi	h,mynick
	call	mputz
	mvi	a,' '
	call	mputc
	lhld	argp
	call	mputz
	jmp	mend

;	/quit [text]: the call is dropped
cquit:	lda	dcd
	ora	a
	jnz	cq1
	lda	dialing
	ora	a
	jnz	hangup		;a dial in progress: give it up
	lxi	h,mnocon
	jmp	info
cq1:	call	sayquit
	jmp	hangup
sayquit:call	bnew
	lxi	h,squit
	call	bstr
	lhld	argp
	mov	a,m
	ora	a
	jnz	cq2
	lxi	h,sbye
cq2:	call	bstr
	call	bsend
	lxi	h,300		;the server closes the line itself
	jmp	delay

;	/bye [text]: the call is dropped and IRC is left
cbye:	lda	dcd
	ora	a
	cnz	sayquit
	lda	dcd
	ora	a
	cnz	hangup
	lda	dialing
	ora	a
	cnz	hangup
exit:	in	mst
	ani	4
	jnz	ex1
	lxi	h,sate1		;the modem echoes again, as TERM expects it
	call	txz
	lxi	h,300
	call	delay
ex1:	lxi	h,sclr
	call	pz
	lhld	savesp
	sphl
	ret

;	/connect [host[:port] | n]
cconn:	call	aword
	shld	w1
	mov	a,m
	ora	a
	jz	showdir
	lda	dcd
	ora	a
	jnz	cc8
	lda	dialing
	ora	a
	jnz	cc9
	lhld	w1
	call	isidx
	jc	cc2
	sta	nth
	call	loaddir
	jc	nodir
	lxi	h,dirbuf
cc1:	call	nextline
	jc	nosuch
	lda	nth
	dcr	a
	sta	nth
	jz	cc4
	xchg
	jmp	cc1
cc2:	lhld	w1
cc4:	call	mkdial
	jmp	docall
cc8:	lxi	h,malready
	jmp	info
cc9:	lxi	h,mdialing
	jmp	info
nodir:	lxi	h,mnodir
	jmp	info
nosuch:	lxi	h,mnosuch
	jmp	info

;	the dial string ATDT host[:port] CR from the text at HL (ended by a blank or any control character);
;	a name with no port gets 6667
mkdial:	lxi	d,dialbuf+4
	mvi	b,40
md1:	mov	a,m
	cpi	21h
	jc	md2
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	md1
md2:	xra	a
	stax	d
	push	d
	lxi	h,dialbuf+4
	mvi	c,0		;bit 0: a colon, bit 1: a letter or a dot
md3:	mov	a,m
	ora	a
	jz	md6
	cpi	':'
	jnz	md4
	mov	a,c
	ori	1
	mov	c,a
	jmp	md5
md4:	cpi	'.'
	jz	md4a
	cpi	'A'
	jc	md5
md4a:	mov	a,c
	ori	2
	mov	c,a
md5:	inx	h
	jmp	md3
md6:	pop	d
	mov	a,c
	cpi	2
	jnz	md8
	lxi	h,sport
md7:	mov	a,m
	ora	a
	jz	md8
	stax	d
	inx	h
	inx	d
	jmp	md7
md8:	mvi	a,cr
	stax	d
	inx	d
	xra	a
	stax	d
	ret

;	dial what MKDIAL made
docall:	lxi	h,dialbuf+4
	lxi	d,srvname
	mvi	b,30
dcl1:	mov	a,m
	cpi	cr
	jz	dcl2
	ora	a
	jz	dcl2
	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	dcl1
dcl2:	xra	a
	stax	d
	mvi	a,1
	sta	dialing
	call	drawstat
	call	mbeg
	lxi	h,sstar
	call	mputz
	lxi	h,mdial
	call	mputz
	lxi	h,srvname
	call	mputz
	call	mend
	lxi	h,dialbuf
	jmp	txz

;	/connect with nothing: the servers of IRC.DIR, numbered
showdir:call	loaddir
	jc	nodir
	xra	a
	sta	nent
	lxi	h,dirbuf
sd1:	call	nextline
	jc	sd9
	lda	nent
	cpi	16
	jnc	sd9
	inr	a
	sta	nent
	push	d
	push	h
	call	mbeg
	lda	nent
	call	mputn
	mvi	a,' '
	call	mputc
	mvi	a,' '
	call	mputc
	pop	h
	pop	d
sd2:	mov	a,m
	call	mputc
	inx	h
	mov	a,l
	cmp	e
	jnz	sd2
	mov	a,h
	cmp	d
	jnz	sd2
	push	d
	call	mend
	pop	h
	jmp	sd1
sd9:	lxi	h,mpick
	jmp	info

;	HL = where to look in DIRBUF: the next line (CY clear): HL its start, DE its end; or CY set at the end
nextline:
nl1:	mov	a,m
	cpi	1ah
	jz	nlend
	ora	a
	jz	nlend
	cpi	21h
	jnc	nl2
	inx	h
	jmp	nl1
nl2:	mov	d,h
	mov	e,l
nl3:	ldax	d
	cpi	20h
	jc	nl4
	inx	d
	jmp	nl3
nl4:	ora	a
	ret
nlend:	stc
	ret

;	read IRC.DIR into DIRBUF (^Z ends it); CY set: no such file
loaddir:lxi	h,fcb
	mvi	c,36
	xra	a
ld0:	mov	m,a
	inx	h
	dcr	c
	jnz	ld0
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
	jnz	ld2
	stc
	ret
ld2:	lxi	h,dirbuf
ld3:	push	h
	xchg
	mvi	c,setdma
	call	bdos
	lxi	d,fcb
	mvi	c,readsq
	call	bdos
	pop	h
	ora	a
	jnz	ld4		;the end of the file
	lxi	d,128
	dad	d
	lxi	d,dirend
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jc	ld3
ld4:	mvi	m,1ah
	lxi	d,80h
	mvi	c,setdma
	call	bdos
	xra	a
	ret

;	a nick of our own: rerun and two digits from the clock
initnick:
	call	now
	mov	a,l
in1:	cpi	100
	jc	in2
	sui	100
	jmp	in1
in2:	mvi	b,'0'
in3:	cpi	10
	jc	in4
	sui	10
	inr	b
	jmp	in3
in4:	adi	'0'
	sta	mynick+6
	mov	a,b
	sta	mynick+5
	xra	a
	sta	mynick+7
	ret

;	the connection is up: say who we are
register:
	call	bnew
	lxi	h,scnick
	call	bstr
	lxi	h,mynick
	call	bstr
	call	bsend
	call	bnew
	lxi	h,suser
	call	bstr
	jmp	bsend

;	---- what the server says ----

;	a byte (A) from the ring: a line is complete at LF
feed:	cpi	cr
	rz
	cpi	lf
	jz	gotline
	ora	a
	rz
	mov	c,a
	lhld	lptr
	lxi	d,lend
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	rnc			;the line is too long: the rest is lost
	mov	m,c
	inx	h
	shld	lptr
	ret
gotline:lhld	lptr
	mvi	m,0
	lxi	h,lbuf
	shld	lptr
	mov	a,m
	ora	a
	rz			;an empty line
	call	strip
	call	parse
	call	getnick
	lhld	cmdp
	push	h
	call	upcase
	pop	b
	lxi	d,srvtab
	call	lookup
	jc	unk
	pchl
unk:	lhld	cmdp
	mov	a,m
	call	isdig
	jnc	hgeneric
	mvi	a,1		;a number: the first parameter is our own nick
	jmp	gen
hgeneric:
	xra	a
	jmp	gen

;	control codes (colours too) out of the line, UTF-8 characters made one ?
strip:	lxi	h,lbuf
	mov	d,h
	mov	e,l
st1:	call	poll		;a long line must not make the modem overrun
	mov	a,m
	inx	h
	ora	a
	jz	st9
	cpi	3
	jz	stcol
	cpi	20h
	jnc	st2
	cpi	1		;CTCP keeps its marks
	jz	st3
	jmp	st1
st2:	cpi	80h
	jc	st3
	cpi	0c0h
	jc	st1		;a continuation byte
	mvi	a,'?'
st3:	stax	d
	inx	d
	jmp	st1
st9:	stax	d
	ret
stcol:	mvi	b,2
	call	skd
	mov	a,m
	cpi	','
	jnz	st1
	inx	h
	mov	a,m
	call	isdig
	jc	stc1
	dcx	h		;a comma that was text
	jmp	st1
stc1:	mvi	b,2
	call	skd
	jmp	st1
skd:	mov	a,m		;skip up to B digits
	call	isdig
	rnc
	inx	h
	dcr	b
	jnz	skd
	ret

;	[:prefix] command params [:trailing]
parse:	xra	a
	sta	parn
	lxi	h,0
	shld	trail
	shld	pfxp
	lxi	h,lbuf
	mov	a,m
	cpi	':'
	jnz	pa1
	inx	h
	shld	pfxp
	call	word
pa1:	shld	cmdp
	call	word
pa2:	mov	a,m
	ora	a
	rz
	cpi	':'
	jnz	pa3
	inx	h
	shld	trail
	ret
pa3:	lda	parn
	cpi	8
	jnc	pa5
	inr	a
	sta	parn
	dcr	a
	add	a
	mov	e,a
	mvi	d,0
	push	h
	lxi	h,parv
	dad	d
	xchg
	pop	h
	mov	a,l
	stax	d
	inx	d
	mov	a,h
	stax	d
pa5:	call	word
	jmp	pa2

;	parameter A (0-7) into HL (an empty text if there is none)
getpar:	mov	b,a
	lda	parn
	cmp	b
	jz	gp0
	jc	gp0
	mov	a,b
	add	a
	mov	e,a
	mvi	d,0
	lxi	h,parv
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	xchg
	ret
gp0:	lxi	h,nul
	ret

;	the nick of the prefix (up to the !) into SNICK
getnick:xra	a
	sta	ufl
	lxi	d,snick
	lhld	pfxp
	mov	a,h
	ora	l
	jz	gn9
	mvi	b,30
gn1:	call	poll
	mov	a,m
	ora	a
	jz	gn9
	cpi	'!'
	jnz	gn2
	mvi	a,1
	sta	ufl
	jmp	gn9
gn2:	stax	d
	inx	h
	inx	d
	dcr	b
	jnz	gn1
gn9:	xra	a
	stax	d
	ret

;	CHANARG: the first parameter, or the trailing text, in W1
chanarg:xra	a
	call	getpar
	mov	a,m
	ora	a
	jnz	ca1
	lhld	trail
	mov	a,h
	ora	l
	jnz	ca1
	lxi	h,nul
ca1:	shld	w1
	ret

;	Z set if the prefix's nick is ours
isme:	lxi	h,snick
	lxi	d,mynick
	jmp	scmp

;	a line of the server's we only show: the command (if A = 0), the parameters from A on, the trailing text
gen:	sta	gidx
	call	mbeg
	lxi	h,sdash
	call	mputz
	lda	gidx
	ora	a
	jnz	gn3
	lhld	cmdp
	call	mputz
	mvi	a,' '
	call	mputc
gn3:	lda	gidx
	mov	b,a
	lda	parn
	cmp	b
	jz	gn4
	jc	gn4
	mov	a,b
	call	getpar
	call	mputz
	mvi	a,' '
	call	mputc
	lda	gidx
	inr	a
	sta	gidx
	jmp	gn3
gn4:	lhld	trail
	mov	a,h
	ora	l
	cnz	mputz
	jmp	mend

;	" (the reason)" from the trailing text, if there is one
reason:	lhld	trail
	mov	a,h
	ora	l
	rz
	mov	a,m
	ora	a
	rz
	lxi	h,sparen
	call	mputz
	lhld	trail
	call	mputz
	mvi	a,')'
	jmp	mputc

;	the server commands
srvtab:	db	'PRIVMSG',0
	dw	hprivmsg
	db	'NOTICE',0
	dw	hnotice
	db	'JOIN',0
	dw	hjoin
	db	'PART',0
	dw	hpart
	db	'QUIT',0
	dw	hquit
	db	'NICK',0
	dw	hnick
	db	'KICK',0
	dw	hkick
	db	'TOPIC',0
	dw	htopic
	db	'PING',0
	dw	hping
	db	'001',0
	dw	h001
	db	'005',0
	dw	hignore
	db	'332',0
	dw	h332
	db	'433',0
	dw	h433
	db	'ERROR',0
	dw	hfail
	db	'NO',0
	dw	hfail
	db	'BUSY',0
	dw	hfail
	db	'OK',0
	dw	hignore
	db	'CONNECT',0
	dw	hignore
	db	'ATE0',0
	dw	hignore
	db	0
hignore:ret

;	the modem (or the server) says the call is not to be: nothing is being dialed any more
hfail:	xra	a
	sta	dialing
	call	drawstat
	xra	a
	jmp	gen

hping:	call	bnew
	lxi	h,spong
	call	bstr
	lhld	trail
	mov	a,h
	ora	l
	jnz	hpi1
	xra	a
	call	getpar
hpi1:	call	bstr
	jmp	bsend

h001:	mvi	a,1
	sta	reg
	xra	a
	call	getpar
	mov	a,m
	ora	a
	jz	h0a
	lxi	d,mynick
	call	copyn
	call	drawstat
h0a:	mvi	a,1
	jmp	gen

h332:	call	mbeg
	lxi	h,stopic0
	call	mputz
	mvi	a,1
	call	getpar
	call	mputz
	lxi	h,scolon
	call	mputz
	lhld	trail
	mov	a,h
	ora	l
	cnz	mputz
	jmp	mend

;	the nick is taken: before we are registered, try another
h433:	lda	reg
	ora	a
	jnz	h4g
	lxi	h,mynick
	mvi	b,0
h4a:	mov	a,m
	ora	a
	jz	h4b
	inx	h
	inr	b
	jmp	h4a
h4b:	mov	a,b
	cpi	28
	jnc	h4g
	mvi	m,'_'
	inx	h
	mvi	m,0
	call	bnew
	lxi	h,scnick
	call	bstr
	lxi	h,mynick
	call	bstr
	call	bsend
	call	drawstat
	lxi	h,mtaken
	jmp	info
h4g:	mvi	a,1
	jmp	gen

;	PRIVMSG and NOTICE: <nick> text, *nick* text (a private message), -nick- text, * nick does something
hprivmsg:
	xra	a
	jmp	hmsg
hnotice:mvi	a,1
hmsg:	sta	mtype
	xra	a
	call	getpar
	shld	w1
	lhld	trail
	mov	a,h
	ora	l
	jnz	hm1
	lxi	h,nul
hm1:	shld	w2
	mov	a,m
	cpi	1
	jnz	hm5
	inx	h		;CTCP: the marks are taken off
	shld	w2
hm1a:	mov	a,m
	ora	a
	jz	hm1b
	cpi	1
	jz	hm1c
	inx	h
	jmp	hm1a
hm1c:	mvi	m,0
hm1b:	lhld	w2
	lxi	d,sactn
	call	starts
	jnz	hm2
	shld	w2
	mvi	a,2
	sta	mkind
	jmp	hm6
hm2:	lhld	w2
	lxi	d,sversion
	call	starts
	rnz
	lda	mtype
	ora	a
	rnz
	call	bnew
	lxi	h,snotice
	call	bstr
	lxi	h,snick
	call	bstr
	lxi	h,sverrep
	call	bstr
	mvi	a,1
	call	badd
	jmp	bsend
hm5:	lda	mtype
	sta	mkind
hm6:	call	mbeg
	lhld	w1
	mov	a,m
	call	ischan
	jc	hm7
	mvi	a,1
	sta	priv
	jmp	hm8
hm7:	xra	a
	sta	priv
	lhld	w1		;a channel that is not the current one is named
	lxi	d,target
	call	scmp
	jz	hm8
	lhld	w1
	call	mputz
	mvi	a,' '
	call	mputc
hm8:	lda	mkind
	cpi	2
	jz	hmact
	cpi	1
	jz	hmnot
	lda	priv
	ora	a
	jz	hmn1
	lxi	h,snick
	lxi	d,target
	call	scmp
	jz	hmn1
	mvi	a,'*'
	call	mputc
	lxi	h,snick
	call	mputz
	mvi	a,'*'
	call	mputc
	jmp	hm9
hmn1:	mvi	a,'<'
	call	mputc
	lxi	h,snick
	call	mputz
	mvi	a,'>'
	call	mputc
	jmp	hm9
hmnot:	mvi	a,'-'
	call	mputc
	lxi	h,snick
	call	mputz
	mvi	a,'-'
	call	mputc
	jmp	hm9
hmact:	lxi	h,sstar1
	call	mputz
	lxi	h,snick
	call	mputz
hm9:	mvi	a,' '
	call	mputc
	lhld	w2
	call	mputz
	jmp	mend

hjoin:	call	chanarg
	call	isme
	jnz	hj2
	lhld	w1		;we joined: it is where we talk now
	lxi	d,target
	call	copyn
	call	drawstat
	call	mbeg
	lxi	h,sjoinme
	call	mputz
	jmp	hj3
hj2:	call	mbeg
	lxi	h,sarrow
	call	mputz
	lxi	h,snick
	call	mputz
	lxi	h,sjoined
	call	mputz
hj3:	lhld	w1
	call	mputz
	jmp	mend

hpart:	call	chanarg
	call	isme
	jnz	hpt2
	lhld	w1
	lxi	d,target
	call	scmp
	jnz	hpt1
	xra	a
	sta	target
	call	drawstat
hpt1:	call	mbeg
	lxi	h,spartme
	call	mputz
	jmp	hpt3
hpt2:	call	mbeg
	lxi	h,sleft1
	call	mputz
	lxi	h,snick
	call	mputz
	lxi	h,sleft2
	call	mputz
hpt3:	lhld	w1
	call	mputz
	call	reason
	jmp	mend

hquit:	call	mbeg
	lxi	h,sleft1
	call	mputz
	lxi	h,snick
	call	mputz
	lxi	h,squit2
	call	mputz
	call	reason
	jmp	mend

hnick:	call	chanarg
	call	isme
	jnz	hn2
	lhld	w1
	lxi	d,mynick
	call	copyn
	call	drawstat
	call	mbeg
	lxi	h,snickme
	call	mputz
	jmp	hn3
hn2:	call	mbeg
	lxi	h,sdash
	call	mputz
	lxi	h,snick
	call	mputz
	lxi	h,snick2
	call	mputz
hn3:	lhld	w1
	call	mputz
	jmp	mend

hkick:	xra	a
	call	getpar
	shld	w1
	mvi	a,1
	call	getpar
	shld	w2
	lxi	d,mynick
	call	scmp
	jnz	hk1
	lhld	w1
	lxi	d,target
	call	scmp
	jnz	hk1
	xra	a
	sta	target
	call	drawstat
hk1:	call	mbeg
	lxi	h,sleft1
	call	mputz
	lhld	w2
	call	mputz
	lxi	h,skicked
	call	mputz
	lhld	w1
	call	mputz
	lxi	h,sby
	call	mputz
	lxi	h,snick
	call	mputz
	call	reason
	jmp	mend

htopic:	call	mbeg
	lxi	h,sdash
	call	mputz
	lxi	h,snick
	call	mputz
	lxi	h,stopic1
	call	mputz
	xra	a
	call	getpar
	call	mputz
	lxi	h,scolon
	call	mputz
	lhld	trail
	mov	a,h
	ora	l
	cnz	mputz
	jmp	mend

;	---- the data ----

nomsg:	db	'No modem on this machine.',cr,lf,'$'
mhello:	db	'IRC for CP/M. /connect dials a server (IRC.DIR lists some), /help lists the commands.',0
mhello2:db	'Say what you like to the current channel; start a command with a slash.',0
mconn:	db	'Connected.',0
mdisc:	db	'Disconnected.',0
mnocon:	db	'Not connected: use /connect first.',0
mnotgt:	db	'No channel or person to talk to: use /join or /query first.',0
mbad:	db	'Unknown command: /help lists them.',0
musage:	db	'Missing argument: /help shows the form.',0
mnodir:	db	'No IRC.DIR on this disk. /connect host[:port] dials by name.',0
mnosuch:db	'No such entry in IRC.DIR.',0
mpick:	db	'/connect n dials one of these, /connect host[:port] any other.',0
malready:db	'Already connected: /quit first.',0
mdialing:db	'Dialing already: /quit gives it up.',0
mdial:	db	'Dialing ',0
mtaken:	db	'That nick is taken, trying another.',0
hlp1:	db	'/connect [host[:port]|n]  /nick name  /join #chan [key]  /part [#chan]  /list [args]',0
hlp2:	db	'/names [#chan]  /msg nick text  /query nick [text]  /me action  /whois nick  /who mask',0
hlp3:	db	'/topic [text]  /mode [+-modes]  /away [text]  /raw line  /clear  /help',0
hlp4:	db	'/quit [text] hangs up; /bye [text] hangs up and leaves. // sends a line that begins with /.',0
hlp5:	db	'Ctrl-U clears the line you are typing.',0
hlp6:	db	'A server must take plain TCP on a port of 6660-6669 (6667 usually): no TLS here.',0
sstar:	db	'*** ',0
sdash:	db	'-- ',0
sstar1:	db	'* ',0
sarrow:	db	'--> ',0
sarrow2:db	'-> ',0
sclose:	db	'> ',0
scolon:	db	': ',0
scoln:	db	' :',0
sparen:	db	' (',0
sjoinme:db	'--> You joined ',0
sjoined:db	' joined ',0
spartme:db	'<-- You left ',0
sleft1:	db	'<-- ',0
sleft2:	db	' left ',0
squit2:	db	' quit',0
skicked:db	' was kicked from ',0
sby:	db	' by ',0
snickme:db	'-- You are now known as ',0
snick2:	db	' is now known as ',0
stopic0:db	'-- Topic of ',0
stopic1:db	' set the topic of ',0
sactn:	db	'ACTION ',0
sversion:db	'VERSION',0
sverrep:db	' :',1,'VERSION DigitalRerun IRC',0
sactp:	db	' :',1,'ACTION ',0
sprivmsg:db	'PRIVMSG ',0
snotice:db	'NOTICE ',0
scnick:	db	'NICK ',0
sjoin:	db	'JOIN ',0
spart:	db	'PART ',0
squit:	db	'QUIT :',0
sbye:	db	'Bye',0
spong:	db	'PONG :',0
suser:	db	'USER rerun 0 * :DigitalRerun IRC',0
vlist:	db	'LIST',0
vwhois:	db	'WHOIS',0
vwho:	db	'WHO',0
vaway:	db	'AWAY',0
vnames:	db	'NAMES',0
vtopic:	db	'TOPIC ',0
vmode:	db	'MODE ',0
sport:	db	':6667',0
sate0:	db	'ATE0',cr,0
sate1:	db	'ATE1',cr,0
nul:	db	0
dirname:db	'IRC     DIR'
sinit:	db	27,'[0m',27,'[r',27,'[2J',27,'[2;23r',0	;plain, no region, clear, the region of the messages
sprompt:db	27,'[24;1H',27,'[K> ',0
sclrin:	db	27,'[24;3H',27,'[K',0
sbs:	db	8,' ',8,0
sclr:	db	27,'[r',27,'[0m',27,'[?25h',27,'[2J',27,'[H',0
mbs:	db	27,'7',27,'[23;1H',lf,0
mes:	db	27,'8',0
sst1:	db	27,'7',27,'[1;1H',27,'[7m',27,'[K IRC  ',0
son:	db	'  on ',0
snot:	db	'  not connected',0
sdial:	db	'  dialing ',0
sto:	db	'  talking to ',0
snone:	db	'nobody',0
sst2:	db	27,'[0m',27,'8',0
rhead:	db	0
rtail:	db	0
dcd:	db	0		;the carrier bit (0 or 4) as the loop last saw it
dialing:db	0
reg:	db	0		;1: the server has welcomed us (001)
ilen:	db	0
mcol:	db	0
priv:	db	0
mkind:	db	0
mtype:	db	0
ufl:	db	0
parn:	db	0
nent:	db	0
nth:	db	0
gidx:	db	0
lptr:	dw	0
argp:	dw	0
w1:	dw	0
w2:	dw	0
trail:	dw	0
pfxp:	dw	0
cmdp:	dw	0
optr:	dw	0
savesp:	dw	0
t0:	dw	0
tlim:	dw	0
parv:	ds	16
mynick:	db	'rerun00',0
	ds	24
target:	db	0
	ds	40
srvname:db	0
	ds	40
dialbuf:db	'ATDT'		;the rest is reserved below: host, :6667, CR, 0
	ds	52
snick:	ds	32		;the nick of the prefix of the line being handled
ibuf:	ds	imax+2
fcb:	ds	36
	ds	256
stktop	equ	$
	ds	(100h-low $) and 0ffh	;the ring starts on a page
ring:	ds	256
lbuf:	ds	520
lend	equ	lbuf+510
obuf:	ds	520
dirbuf:	ds	1664
dirend	equ	dirbuf+1536
	end
