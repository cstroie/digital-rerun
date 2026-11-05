;	TERM: a terminal for the modem port
;
;	What is typed goes out of the modem (ports 6 and 7), what comes in goes
;	to the screen. Talk to the modem in AT commands: ATDT then a number.
;	Ctrl-] opens a menu: D dials a number from TERM.DIR, L redials, Z and F
;	reset the modem, E escapes to command mode (+++) and O goes back on line,
;	M K A toggle speaker, echo and auto-answer, I asks the modem who it is.
;	R receives a file and S sends one (XMODEM, checksum), Q quits (the call
;	stays up, run TERM again to come back), H hangs up, ^] sends a Ctrl-].
;	A>TERM
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
nokey:	lda	pend
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

;	Ctrl-] and a letter
command:
	lxi	d,menu
	mvi	c,print
	call	bdos
cmd1:	mvi	c,1		;a key, with echo
	call	bdos
	ani	5fh		;upper case
	cpi	'Q'
	jz	quit
	cpi	'H'
	jz	hang
	cpi	'R'
	jz	receive
	cpi	'S'
	jz	send
	cpi	esc & 5fh
	jz	sendesc
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
	jmp	command		;anything else: the menu again
sendesc:
	mvi	a,esc
	sta	pend
	jmp	loop

;	---- the modem commands (the modem must be in command mode) ----

;	return to the caller if AT text may go to the modem; else say so and back to the loop
chkoff:	lda	cm
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
atcmd:	call	sendat
	jmp	loop
reset:	call	chkoff
	lxi	d,atz
	jmp	reset1
factory:call	chkoff
	lxi	d,atf
reset1:	xra	a
	sta	cm
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
	sta	cm
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
	sta	cm
	jmp	loop
goon:	lda	cm
	ora	a
	jnz	go1
	lxi	d,mnoesc
	call	pr
	jmp	loop
go1:	xra	a
	sta	cm
	lxi	d,ato
	jmp	atcmd

;	D: dial a number from TERM.DIR (or type one)
dial:	call	chkoff
	call	loaddir
	jnc	dr0
	lxi	d,mnodir
	call	pr
	jmp	manual
dr0:	lxi	d,mdial
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
	lda	nent
	call	keych
	mov	e,a
	mvi	c,2
	call	bdos
	mvi	e,' '
	mvi	c,2
	call	bdos
	pop	h
dr2:	mov	a,m
	cpi	' '
	jc	dr3
	push	h
	mov	e,a
	mvi	c,2
	call	bdos
	pop	h
	inx	h
	jmp	dr2
dr3:	push	h
	lxi	d,crlf
	call	pr
	pop	h
	lda	nent
	inr	a
	sta	nent
	jmp	dr1
dr8:	inx	h
	jmp	dr1
dr9:	lxi	d,mwhich
	call	pr
	mvi	c,1
	call	bdos
	cpi	'#'
	jz	manual0
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
	lxi	d,crlf
	call	pr
	jmp	dodial
manual0:lxi	d,crlf
	call	pr
manual:	lxi	d,pnum
	call	pr
	lxi	d,numbuf
	mvi	c,rdbuf
	call	bdos
	lxi	d,crlf
	call	pr
	lda	numbuf+1
	ora	a
	jz	loop
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
cancel:	lxi	d,crlf
	call	pr
	jmp	loop
dodial:	mvi	a,1
	sta	havenum
	xra	a
	sta	cm
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

hang:	xra	a		;DTR down and up again
	sta	cm
	out	mctl
	mvi	a,1
	out	mctl
	lxi	d,rstr		;a board may have set a scroll region: set the terminal right
	call	pr
	lxi	d,hungup
	mvi	c,print
	call	bdos
	jmp	loop
quit:	lxi	d,rstr
	call	pr
	lxi	d,crlf
	mvi	c,print
	call	bdos
	ret

;	---- XMODEM (checksum, 128 byte blocks) ----

pr:	mvi	c,print		;print the $ string at DE
	jmp	bdos

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
rstr:	db	27,'[r',27,'[0m',27,'[?25h$'	;no scroll region, plain, the cursor shown
nomsg:	db	'No modem on this machine.',cr,lf,'$'
hello:	db	'TERM: Ctrl-] for the menu. Try ATDT0100.',cr,lf,'$'
menu:	db	cr,lf,'D dial from TERM.DIR  L redial  Z reset  F factory reset  I modem info',cr,lf
	db	'E escape (+++)  O back on line  M speaker  K echo  A auto-answer',cr,lf
	db	'R receive  S send (XMODEM)  H hang up  Q quit  ^] sends a ^]   Key? $'
mdial:	db	cr,lf,'$'
mwhich:	db	'Which (# types a number)? $'
pnum:	db	'Number or host? $'
mnodir:	db	'No TERM.DIR on this disk.',cr,lf,'$'
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
cm:	db	0		;1: we escaped, the modem is in command mode with the carrier up
spk:	db	1
ech:	db	1
aa:	db	0
havenum:db	0
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
dirbuf:	ds	1664
dirend	equ	dirbuf+1536
	end
