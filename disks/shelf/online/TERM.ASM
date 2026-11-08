;	TERM: a terminal for the modem port
;
;	What is typed goes out of the modem (ports 6 and 7), what comes in goes
;	to the screen. Talk to the modem in AT commands: ATDT then a number.
;	Ctrl-] opens a full-screen menu (a VT100 terminal): the keys on top, the
;	state of the line and the modem's answers below. D dials a number from
;	TERM.DIR, L redials, Z and F reset the modem, E escapes to command mode
;	(+++) and O goes back on line, M K A toggle speaker, echo and
;	auto-answer, I asks the modem who it is. R receives a file and S sends
;	one (XMODEM, checksum), Q quits (the call stays up, run TERM again to
;	come back), H hangs up, Esc or Space is back to the terminal, and Ctrl-]
;	in the menu sends a Ctrl-]. A>TERM
;
;	A>TERM telehack.com (or a number, or a word of a name in TERM.DIR: A>TERM
;	telehack) dials at once.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
conio	equ	6		;direct console I/O: E = 0FFh reads a key (A = 0: none)
print	equ	9
rdbuf	equ	10		;buffered console input
delete	equ	19
readsq	equ	20
writsq	equ	21
makef	equ	22
openf	equ	15
closef	equ	16
setdma	equ	26
clk	equ	20		;the clock port: OUT latches, IN reads the record
soh	equ	1		;XMODEM
eot	equ	4
ack	equ	6
nak	equ	15h
can	equ	18h
mst	equ	6		;modem status: bit 0 byte waiting, bit 1 may send, bit 2 carrier
mctl	equ	6		;modem control: bit 0 DTR
mdat	equ	7		;modem data
esc	equ	1dh		;Ctrl-]
cr	equ	13
lf	equ	10

	org	100h
	call	getarg		;the command line first: the file calls below overwrite it
	in	mst
	cpi	0ffh		;nothing answers: no modem here
	jnz	have
	lxi	d,nomsg
	mvi	c,print
	call	bdos
	ret
have:	mvi	a,1		;DTR up
	out	mctl
	lxi	d,hello
	mvi	c,print
	call	bdos
	xra	a
	sta	pend
	lda	cmdarg		;TERM name: dial it
	ora	a
	cnz	cmddial

;	the loop: take what came in, then send a key if the line can take one
loop:	in	mst
	mov	b,a
	ani	1
	jz	nokey
	in	mdat
	ani	7fh
	mov	e,a
	mvi	c,conio
	call	bdos
	jmp	loop		;more may be waiting
nokey:	lda	inmenu
	ora	a
	jz	nk1
	mov	a,b		;the menu is up: show when the carrier comes or goes
	ani	4
	lxi	h,dcd
	cmp	m
	jz	nk1
	call	drawstat
	jmp	loop
nk1:	lda	pend
	ora	a
	jnz	tosend
	lhld	outq		;text for the modem (a menu command) goes first, a byte a time
	mov	a,h
	ora	l
	jz	getkey
	in	mst
	ani	2
	jz	loop
	mov	a,m
	ora	a
	jz	qend
	out	mdat
	inx	h
	shld	outq
	jmp	loop
qend:	lxi	h,0
	shld	outq
	jmp	loop
getkey:	mvi	e,0ffh
	mvi	c,conio
	call	bdos
	ora	a
	jz	loop
	mov	b,a
	lda	inmenu
	ora	a
	mov	a,b
	jnz	mkey		;the menu is up: the key is its
	cpi	esc
	jz	command
	sta	pend
tosend:	in	mst
	ani	2
	jz	loop		;the transmitter is busy: look at the line again
	lda	pend
	out	mdat
	xra	a
	sta	pend
	jmp	loop

;	Ctrl-]: the menu, a screen of its own. The loop goes on while it is up (the
;	modem's answers scroll in the lower half), and the keys are the menu's.
command:
	mvi	a,1
	sta	inmenu
	call	drawmenu
	jmp	loop

drawmenu:
	lxi	d,scr
	call	pr
	call	drawstat
	lxi	d,home
	jmp	pr

;	a key (in A) while the menu is up
mkey:	cpi	esc
	jnz	mk1
	call	leave
	jmp	sendesc		;Ctrl-] in the menu sends one
mk1:	cpi	1bh
	jz	mleave
	cpi	' '
	jz	mleave
	cpi	cr
	jz	mleave
	ani	5fh		;upper case
	cpi	'Q'
	jz	quit
	cpi	'H'
	jz	hang
	cpi	'R'
	jz	mxrecv
	cpi	'S'
	jz	mxsend
	cpi	'D'
	jz	dial
	cpi	'L'
	jz	redial
	cpi	'Z'
	jz	reset
	cpi	'F'
	jz	factory
	cpi	'E'
	jz	escape
	cpi	'O'
	jz	goon
	cpi	'I'
	jz	info
	cpi	'M'
	jz	speaker
	cpi	'K'
	jz	echoer
	cpi	'A'
	jz	autoans
	jmp	loop		;anything else: nothing
mleave:	call	leave
	jmp	loop
mxrecv:	call	leave
	jmp	receive
mxsend:	call	leave
	jmp	send
sendesc:
	mvi	a,esc
	sta	pend
	jmp	loop

;	the menu is done: the terminal right, the screen clear
leave:	xra	a
	sta	inmenu
	lxi	d,clrs
	jmp	pr

hang:	xra	a		;DTR down and up again
	sta	cmode
	out	mctl
	mvi	a,1
	out	mctl
	call	drawstat
	lxi	d,hungup
	call	pr
	jmp	loop
quit:	call	leave
	ret

;	the state rows of the menu (the cursor is kept where it was)
drawstat:
	lda	inmenu
	ora	a
	rz
	in	mst
	ani	4
	sta	dcd
	lxi	d,st1
	call	pr
	lda	cmode
	ora	a
	lxi	d,lcmd
	jnz	ds1
	in	mst
	ani	4
	lxi	d,lon
	jnz	ds1
	lxi	d,loff
ds1:	call	pr
	lxi	d,st2
	call	pr
	lda	havenum
	ora	a
	jz	ds3
	lxi	h,dialbuf+4
ds2:	mov	a,m
	cpi	cr
	jz	ds3
	push	h
	mov	e,a
	mvi	c,conio
	call	bdos
	pop	h
	inx	h
	jmp	ds2
ds3:	lxi	d,st3
	call	pr
	lda	spk
	call	onoff
	lxi	d,st4
	call	pr
	lda	ech
	call	onoff
	lxi	d,st5
	call	pr
	lda	aa
	call	onoff
	lxi	d,st6
	jmp	pr
onoff:	ora	a
	lxi	d,sof
	jz	oo1
	lxi	d,son
oo1:	jmp	pr

;	the cursor to row CROW, column CCOL; one character (A) to the console; A in decimal
gotoxy:	mvi	a,27
	call	putc
	mvi	a,'['
	call	putc
	lda	crow
	call	pdec
	mvi	a,';'
	call	putc
	lda	ccol
	call	pdec
	mvi	a,'H'
putc:	mov	e,a
	mvi	c,conio
	jmp	bdos
pdec:	mvi	b,0
pd1:	cpi	10
	jc	pd2
	sui	10
	inr	b
	jmp	pd1
pd2:	push	psw
	mov	a,b
	ora	a
	jz	pd3
	adi	'0'
	call	putc
pd3:	pop	psw
	adi	'0'
	jmp	putc

;	---- the modem commands (the modem must be in command mode) ----

;	return to the caller if AT text may go to the modem; else say so and back to the loop
chkoff:	lda	cmode
	ora	a
	rnz			;we escaped: it is in command mode
	in	mst
	ani	4
	rz			;no carrier
	lxi	d,monl
	call	pr
	pop	h
	jmp	loop

;	queue the 0-ended text at DE for the modem
sendat:	xchg
	shld	outq		;the loop sends it while it shows what the modem says
	ret

;	wait HL milliseconds (the line is read meanwhile so an idle machine lets the clock run)
delay:	push	h
	call	now
	shld	t0
	pop	h
	shld	tlim
dl1:	in	mst
	ani	1
	jz	dl2
	in	mdat
dl2:	call	now
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

;	a plain AT command: DE has it
atcmd:	push	d
	call	drawstat
	pop	d
	call	sendat
	jmp	loop
reset:	call	chkoff
	lxi	d,atz
	jmp	reset1
factory:call	chkoff
	lxi	d,atf
reset1:	xra	a
	sta	cmode
	sta	aa
	inr	a
	sta	spk
	sta	ech
	jmp	atcmd
info:	call	chkoff
	lxi	d,ati
	jmp	atcmd
redial:	call	chkoff
	lda	havenum
	ora	a
	jnz	rd1
	lxi	d,mnonum
	call	pr
	jmp	loop
rd1:	xra	a
	sta	cmode
	call	leave
	lxi	d,dialbuf
	jmp	atcmd

;	M, K: toggle the speaker (ATM0/1) and the echo (ATE0/1)
speaker:call	chkoff
	lxi	h,spk
	mvi	b,'M'
	jmp	setopt
echoer:	call	chkoff
	lxi	h,ech
	mvi	b,'E'
setopt:	mov	a,m
	xri	1
	mov	m,a
	adi	'0'
	sta	opt+3
	mov	a,b
	sta	opt+2
	lxi	d,opt
	jmp	atcmd
autoans:call	chkoff
	lda	aa
	xri	1
	sta	aa
	lxi	d,ats00
	jz	atcmd
	lxi	d,ats01
	jmp	atcmd

;	E: escape to command mode (a second of silence, then +++; the modem answers OK after another)
escape:	in	mst
	ani	4
	jnz	es1
	lxi	d,mnoon
	call	pr
	jmp	loop
es1:	lxi	d,mesc
	call	pr
	lxi	h,1100
	call	delay
	mvi	a,'+'
	call	txb
	call	txb
	call	txb		;the second of silence after it is the modem's to measure: its OK comes then
	mvi	a,1
	sta	cmode
	call	drawstat
	jmp	loop
goon:	lda	cmode
	ora	a
	jnz	go1
	lxi	d,mnoesc
	call	pr
	jmp	loop
go1:	xra	a
	sta	cmode
	call	leave
	lxi	d,ato
	jmp	atcmd

;	D: dial a number from TERM.DIR (or type one)
dial:	call	chkoff
	call	loaddir
	jnc	dr0
	lxi	d,mnodir
	call	pr
	jmp	manual
dr0:	lxi	d,clrreg
	call	pr
	xra	a
	sta	nent
	lxi	h,dirbuf
dr1:	mov	a,m
	cpi	1ah
	jz	dr9
	ora	a
	jz	dr9
	cpi	21h
	jc	dr8		;blanks and line ends
	lda	nent
	cpi	16
	jnc	dr9
	push	h		;the line starts here: remember where
	add	a
	mov	e,a
	mvi	d,0
	lxi	h,ent
	dad	d
	pop	d
	mov	m,e
	inx	h
	mov	m,d
	xchg			;HL = the line
	push	h
	lda	nent		;entries 0-7 down the left, 8-15 down the right
	mov	b,a
	ani	7
	adi	15
	sta	crow
	mov	a,b
	ani	8
	mvi	a,1
	jz	dr1a
	mvi	a,41
dr1a:	sta	ccol
	call	gotoxy
	lda	nent
	call	keych
	call	putc
	mvi	a,' '
	call	putc
	pop	h
dr2:	mov	a,m
	cpi	' '
	jc	dr3
	push	h
	call	putc
	pop	h
	inx	h
	jmp	dr2
dr3:	lda	nent
	inr	a
	sta	nent
	jmp	dr1
dr8:	inx	h
	jmp	dr1
dr9:	lxi	d,mwhich
	call	pr
dk0:	mvi	e,0ffh		;a key, with no echo
	mvi	c,conio
	call	bdos
	ora	a
	jz	dk0
	cpi	'#'
	jz	manual
	cpi	1bh
	jz	cancel
	call	upper
	cpi	'A'
	jnc	dk1
	cpi	'9'+1
	jnc	cancel
	sui	'1'
	jc	cancel
	jmp	dk2
dk1:	sui	'A'-9
dk2:	mov	b,a
	lda	nent
	cmp	b
	jc	cancel
	jz	cancel
	mov	a,b
	add	a
	mov	e,a
	mvi	d,0
	lxi	h,ent
	dad	d
	mov	e,m
	inx	h
	mov	d,m
	xchg			;HL = the chosen line
	lxi	d,dialbuf+4
	mvi	c,24
dk3:	mov	a,m
	cpi	21h
	jc	dk4
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	dk3
dk4:	mvi	a,cr
	stax	d
	inx	d
	xra	a
	stax	d
	jmp	dodial
manual:	lxi	d,pnum
	call	pr
	lxi	d,numbuf
	mvi	c,rdbuf
	call	bdos
	lda	numbuf+1
	ora	a
	jz	cancel
	mov	c,a
	lxi	h,numbuf+2
	lxi	d,dialbuf+4
mn1:	mov	a,m
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	mn1
	jmp	dk4
cancel:	call	drawmenu
	jmp	loop
dodial:	mvi	a,1
	sta	havenum
	xra	a
	sta	cmode
	call	leave
	lxi	d,dialbuf
	jmp	atcmd

;	the key for entry A: 1-9 then A-
keych:	cpi	9
	jc	kc1
	adi	'A'-9
	ret
kc1:	adi	'1'
	ret

;	read TERM.DIR into DIRBUF (^Z ends it); CY set: no such file
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

;	---- the command line: A>TERM telehack.com, A>TERM 0100, A>TERM telehack ----

;	the first word of the command line into CMDARG, in lower case (0-ended, 24 characters at most)
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
ga2:	mvi	c,24
ga3:	ldax	d
	cpi	21h
	jc	ga9
	call	lower
	mov	m,a
	inx	h
	inx	d
	dcr	c
	jz	ga9
	dcr	b
	jnz	ga3
ga9:	mvi	m,0
	ret

;	dial CMDARG: a line of TERM.DIR that has it anywhere in it (a number, a host, a word of the
;	name) gives the string to dial, else CMDARG is dialed as it is. Back at the caller
cmddial:call	chkoff
	lxi	h,cmdarg
	shld	fkarg
	mov	a,m
	cpi	'0'
	jc	cd5
	cpi	':'
	jc	cd2		;a number is dialed as it is
cd5:	call	loaddir
	jc	cd2
	call	findkey
	jnc	cd1
cd2:	lxi	h,cmdarg
cd1:	lxi	d,dialbuf+4
	mvi	c,24
cd3:	mov	a,m
	cpi	21h
	jc	cd4
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	cd3
cd4:	mvi	a,cr
	stax	d
	inx	d
	xra	a
	stax	d
	mvi	a,1
	sta	havenum
	xra	a
	sta	cmode
	lxi	d,dialbuf
	jmp	sendat

;	the first line of TERM.DIR (in DIRBUF) that has the text at FKARG in it, in either case:
;	CY clear and HL its start; CY set if there is none
findkey:lxi	h,dirbuf
fk1:	call	tnext
	rc
	shld	fkst
	xchg
	shld	fkend
	lhld	fkst
fk2:	shld	fkp
	xchg
	lhld	fkarg
	xchg			;DE the text, HL the place in the line
fk3:	ldax	d
	ora	a
	jz	fkyes
	call	lower
	mov	b,a
	mov	a,m
	call	lower
	cmp	b
	jnz	fk4
	inx	h
	inx	d
	jmp	fk3
fk4:	lhld	fkp
	inx	h
	xchg			;DE the new place
	lhld	fkend
	mov	a,e
	sub	l
	mov	a,d
	sbb	h
	jnc	fk5		;past the end of the line
	xchg
	jmp	fk2
fk5:	lhld	fkend
	jmp	fk1
fkyes:	lhld	fkst
	ora	a
	ret

;	the next line at or after HL in DIRBUF: HL its start, DE its end; CY set at the end of the file
tnext:	mov	a,m
	cpi	1ah
	jz	tn9
	ora	a
	jz	tn9
	cpi	21h
	jc	tn1
	push	h
tn2:	mov	a,m
	cpi	' '
	jc	tn3
	inx	h
	jmp	tn2
tn3:	xchg
	pop	h
	ora	a
	ret
tn1:	inx	h
	jmp	tnext
tn9:	stc
	ret

;	A in lower case
lower:	cpi	'A'
	rc
	cpi	'['
	rnc
	adi	20h
	ret

;	---- XMODEM (checksum, 128 byte blocks) ----

;	print the $ string at DE through the direct console call (BDOS 6): the other output calls
;	look at the keyboard and keep a key for themselves, which the menu's reads would miss
pr:	ldax	d
	cpi	'$'
	rz
	push	d
	mov	e,a
	mvi	c,conio
	call	bdos
	pop	d
	inx	d
	jmp	pr

;	R: receive a file
receive:
	call	askname
	jc	xdone
	lxi	d,fcb
	mvi	c,delete	;an old copy goes
	call	bdos
	lxi	d,fcb
	mvi	c,makef
	call	bdos
	inr	a
	jnz	rx0
	lxi	d,mnomk
	call	pr
	jmp	xdone
rx0:	lxi	d,mrecv
	call	pr
	mvi	a,1
	sta	blk
	xra	a
	sta	retries
	sta	abort
rxnak:	mvi	a,nak
	call	txb
rxsoh:	lxi	h,10000
	shld	tlim
	call	getb
	jc	rxtime
	cpi	soh
	jz	rxblk
	cpi	eot
	jz	rxeot
	cpi	can
	jz	rxcan
	jmp	rxsoh		;noise
rxtime:	lda	abort
	ora	a
	jnz	rxcan
	lda	retries
	inr	a
	sta	retries
	cpi	10
	jc	rxnak
	jmp	rxcan
rxblk:	lxi	h,1000
	shld	tlim
	call	getb		;block number
	jc	rxbad
	sta	rblk
	call	getb		;its complement
	jc	rxbad
	mov	b,a
	lda	rblk
	add	b
	cpi	0ffh
	jnz	rxbad
	lxi	h,buf
	mvi	c,128
	xra	a
	sta	sum
rxd:	call	getb
	jc	rxbad
	mov	m,a
	inx	h
	mov	e,a
	lda	sum
	add	e
	sta	sum
	dcr	c
	jnz	rxd
	call	getb		;the checksum
	jc	rxbad
	mov	b,a
	lda	sum
	cmp	b
	jnz	rxbad
	lda	rblk		;the block we want?
	mov	b,a
	lda	blk
	cmp	b
	jz	rxnew
	dcr	a		;the one before: the sender missed our ACK
	cmp	b
	jz	rxack
	jmp	rxcan
rxnew:	lxi	d,buf
	mvi	c,setdma
	call	bdos
	lxi	d,fcb
	mvi	c,writsq
	call	bdos
	ora	a
	jnz	rxfull
	lxi	d,80h
	mvi	c,setdma
	call	bdos
	lda	blk
	inr	a
	sta	blk
	mvi	e,'.'
	mvi	c,2
	call	bdos
	xra	a
	sta	retries
rxack:	mvi	a,ack
	call	txb
	jmp	rxsoh
rxbad:	call	purge
	lda	retries
	inr	a
	sta	retries
	cpi	10
	jc	rxnak
	jmp	rxcan
rxeot:	mvi	a,ack
	call	txb
	lxi	d,fcb
	mvi	c,closef
	call	bdos
	lxi	d,mdone
	call	pr
	jmp	xdone
rxfull:	mvi	a,can
	call	txb
	mvi	a,can
	call	txb
	lxi	d,fcb
	mvi	c,closef
	call	bdos
	lxi	d,mfull
	call	pr
	jmp	xdone
rxcan:	lxi	d,fcb
	mvi	c,closef
	call	bdos
	lxi	d,mstop
	call	pr
	jmp	xdone

;	S: send a file
send:	call	askname
	jc	xdone
	lxi	d,fcb
	mvi	c,openf
	call	bdos
	inr	a
	jnz	tx0
	lxi	d,mnofl
	call	pr
	jmp	xdone
tx0:	lxi	d,msend
	call	pr
	xra	a
	sta	abort
txst:	lxi	h,60000		;wait for the receiver's NAK
	shld	tlim
	call	getb
	jc	txstop
	cpi	nak
	jz	txgo
	cpi	can
	jz	txstop
	jmp	txst
txgo:	mvi	a,1
	sta	blk
txblk:	lxi	d,buf+3
	mvi	c,setdma
	call	bdos
	lxi	d,fcb
	mvi	c,readsq
	call	bdos
	ora	a
	jnz	txend
	lxi	d,80h
	mvi	c,setdma
	call	bdos
	lxi	h,buf		;the header and the checksum
	mvi	m,soh
	inx	h
	lda	blk
	mov	m,a
	inx	h
	cma
	mov	m,a
	lxi	h,buf+3
	mvi	c,128
	xra	a
txsum:	add	m
	inx	h
	dcr	c
	jnz	txsum
	sta	buf+131
	xra	a
	sta	retries
txagn:	lxi	h,buf
	mvi	c,132
txout:	mov	a,m
	call	txb
	inx	h
	dcr	c
	jnz	txout
	lxi	h,10000
	shld	tlim
	call	getb
	jc	txretry
	cpi	ack
	jz	txnext
	cpi	can
	jz	txstop
txretry:
	lda	abort
	ora	a
	jnz	txstop
	lda	retries
	inr	a
	sta	retries
	cpi	10
	jc	txagn
	jmp	txstop
txnext:	lda	blk
	inr	a
	sta	blk
	mvi	e,'.'
	mvi	c,2
	call	bdos
	jmp	txblk
txend:	xra	a
	sta	retries
txeot:	mvi	a,eot
	call	txb
	lxi	h,10000
	shld	tlim
	call	getb
	jc	txeotr
	cpi	ack
	jz	txok
txeotr:	lda	retries
	inr	a
	sta	retries
	cpi	10
	jc	txeot
	jmp	txstop
txok:	lxi	d,mdone
	call	pr
	jmp	xdone
txstop:	mvi	a,can
	call	txb
	lxi	d,mstop
	call	pr
xdone:	jmp	loop

;	ask for a file name (the prompt), make the FCB; CY set: nothing to do
askname:
	lxi	d,pname
	call	pr
	lxi	d,linebuf
	mvi	c,rdbuf
	call	bdos
	lxi	d,crlf
	call	pr
	lda	linebuf+1
	ora	a
	stc
	rz
	mov	b,a		;length
	lxi	h,fcb		;a clean FCB: drive 0, name and type blank
	mvi	c,36
	xra	a
an0:	mov	m,a
	inx	h
	dcr	c
	jnz	an0
	lxi	h,fcb+1
	mvi	c,11
	mvi	a,' '
an1:	mov	m,a
	inx	h
	dcr	c
	jnz	an1
	lxi	h,linebuf+2
	mov	a,b		;a drive letter?
	cpi	2
	jc	an2
	inx	h
	mov	a,m
	dcx	h
	cpi	':'
	jnz	an2
	mov	a,m
	call	upper
	sui	'A'-1
	sta	fcb
	inx	h
	inx	h
	dcr	b
	dcr	b
an2:	lxi	d,fcb+1		;the name, up to 8
	mvi	c,8
an3:	mov	a,b
	ora	a
	jz	an9
	mov	a,m
	cpi	'.'
	jz	an4
	call	upper
	dcr	b
	inx	h
	push	psw
	mov	a,c
	ora	a
	jz	an3x		;a ninth letter is dropped
	pop	psw
	stax	d
	inx	d
	dcr	c
	jmp	an3
an3x:	pop	psw
	jmp	an3
an4:	inx	h		;the type, up to 3
	dcr	b
	lxi	d,fcb+9
	mvi	c,3
an5:	mov	a,b
	ora	a
	jz	an9
	mov	a,m
	call	upper
	dcr	b
	inx	h
	push	psw
	mov	a,c
	ora	a
	jz	an5x
	pop	psw
	stax	d
	inx	d
	dcr	c
	jmp	an5
an5x:	pop	psw
	jmp	an5
an9:	ora	a		;CY clear
	ret

upper:	cpi	'a'
	rc
	cpi	'{'
	rnc
	sui	20h
	ret

;	send A to the modem when it may take it
txb:	push	psw
txb1:	in	mst
	ani	2
	jz	txb1
	pop	psw
	out	mdat
	ret

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

;	a byte from the modem into A, CY set if none came within TLIM ms (or Ctrl-X)
getb:	push	b
	push	d
	push	h
	call	now
	shld	t0
	mvi	b,0
gb1:	in	mst
	ani	1
	jnz	gb2
	dcr	b
	jnz	gb1
	mvi	e,0ffh		;every 256 looks: Ctrl-X? time up?
	mvi	c,conio
	call	bdos
	cpi	18h
	jnz	gb3
	sta	abort
	jmp	gbt
gb3:	call	now
	xchg			;DE = now
	lhld	t0
	mov	a,e		;now - start
	sub	l
	mov	l,a
	mov	a,d
	sbb	h
	mov	h,a
	xchg			;DE = elapsed
	lhld	tlim
	mov	a,e		;elapsed - limit
	sub	l
	mov	a,d
	sbb	h
	jnc	gbt		;no borrow: time is up
	mvi	b,0
	jmp	gb1
gb2:	in	mdat
	ora	a		;CY clear
	jmp	gbx
gbt:	stc
gbx:	pop	h
	pop	d
	pop	b
	ret

;	throw away what comes until the line is quiet for a while
purge:	lxi	h,300
	shld	tlim
	call	getb
	jnc	purge
	ret


pend:	db	0		;a key waiting for the transmitter
outq:	dw	0		;the menu's text for the modem, when there is some
nomsg:	db	'No modem on this machine.',cr,lf,'$'
hello:	db	'TERM: Ctrl-] for the menu. Try ATDT0100.',cr,lf,'$'
scr:	db	27,'[r',27,'[0m',27,'[2J'
	db	27,'[1;1H',27,'[7m',27,'[K',27,'[1;2HTERM: the modem menu',27,'[1;52HEsc or Space: the terminal',27,'[0m'
	db	27,'[3;3H',27,'[1mCALL',27,'[3;29HMODEM',27,'[3;55HFILES AND EXIT',27,'[0m'
	db	27,'[4;3HD  Dial from directory',27,'[4;29HZ  Reset (ATZ)',27,'[4;55HR  Receive a file'
	db	27,'[5;3HL  Redial last number',27,'[5;29HF  Factory settings',27,'[5;55HS  Send a file'
	db	27,'[6;3HE  Escape (+++)',27,'[6;29HI  Who are you? (ATI3)',27,'[6;55HQ  Quit TERM'
	db	27,'[7;3HO  Back on line (ATO)',27,'[7;29HM  Speaker on/off',27,'[7;55HEsc  Back to the terminal'
	db	27,'[8;3HH  Hang up (DTR)',27,'[8;29HK  Echo on/off',27,'[8;55H^]  Send a Ctrl-]'
	db	27,'[9;29HA  Auto-answer on/off'
	db	27,'[11;1H',27,'[7m',27,'[K',27,'[11;2HSTATUS',27,'[0m'
	db	27,'[14;1H',27,'[7m',27,'[K',27,'[14;2HTHE MODEM SAYS',27,'[0m'
	db	27,'[24;1H',27,'[7m',27,'[K',27,'[24;2HA key chooses. What the modem answers shows above.',27,'[0m'
	db	27,'[15;22r$'
home:	db	27,'[15;1H$'
clrs:	db	27,'[r',27,'[0m',27,'[?25h',27,'[2J',27,'[H$'	;no region, plain, cursor shown, a clear screen
clrreg:	db	27,'[22;1H',10,10,10,10,10,10,10,10,27,'[15;1H$'	;the lower half scrolled clean
st1:	db	27,'7',27,'[12;3H',27,'[KLine: $'
st2:	db	'     Last number: $'
st3:	db	27,'[13;3H',27,'[KSpeaker: $'
st4:	db	'   Echo: $'
st5:	db	'   Auto-answer: $'
st6:	db	27,'8$'
lon:	db	'ON LINE (a call is up)$'
lcmd:	db	'COMMAND MODE (escaped, the call is up)$'
loff:	db	'off line$'
son:	db	'on$'
sof:	db	'off$'
mwhich:	db	27,'[23;1H',27,'[KWhich? A key, # to type a number, Esc to cancel: $'
pnum:	db	27,'[23;1H',27,'[KNumber or host? $'
mnodir:	db	cr,lf,'No TERM.DIR on this disk.$'
monl:	db	cr,lf,'On line: use E (escape) first.',cr,lf,'$'
mnoon:	db	cr,lf,'Not on line.',cr,lf,'$'
mesc:	db	cr,lf,'Escaping: a second of silence...',cr,lf,'$'
mnoesc:	db	cr,lf,'Not escaped: use E first.',cr,lf,'$'
mnonum:	db	cr,lf,'Nothing dialed yet: use D.',cr,lf,'$'
atz:	db	'ATZ',cr,0
atf:	db	'AT&F',cr,0
ati:	db	'ATI3',cr,0
ato:	db	'ATO',cr,0
ats00:	db	'ATS0=0',cr,0
ats01:	db	'ATS0=1',cr,0
opt:	db	'AT??',cr,0
dirname:db	'TERM    DIR'
cmode:	db	0		;1: we escaped, the modem is in command mode with the carrier up
spk:	db	1
ech:	db	1
aa:	db	0
havenum:db	0
inmenu:	db	0		;1: the menu is up
dcd:	db	0		;the carrier bit as the menu last showed it
crow:	db	0
ccol:	db	0
dialbuf:db	'ATDT'
	ds	30
numbuf:	db	24,0
	ds	24
hungup:	db	cr,lf,'Hung up.',cr,lf,'$'
crlf:	db	cr,lf,'$'
pname:	db	'File name? $'
mrecv:	db	'Receiving: start the sender. Ctrl-X stops.',cr,lf,'$'
msend:	db	'Sending: waiting for the receiver. Ctrl-X stops.',cr,lf,'$'
mdone:	db	cr,lf,'Done.',cr,lf,'$'
mstop:	db	cr,lf,'Transfer stopped.',cr,lf,'$'
mfull:	db	cr,lf,'The disk is full.',cr,lf,'$'
mnomk:	db	'Cannot make that file.',cr,lf,'$'
mnofl:	db	'No such file.',cr,lf,'$'
blk:	db	0
rblk:	db	0
sum:	db	0
retries:db	0
abort:	db	0
tlim:	dw	0
t0:	dw	0
linebuf:db	14,0
	ds	14
fcb:	ds	36
buf:	ds	133
ent:	ds	32
nent:	ds	1
cmdarg:	ds	26
fkarg:	ds	2
fkst:	ds	2
fkend:	ds	2
fkp:	ds	2
dirbuf:	ds	1664
dirend	equ	dirbuf+1536
	end
