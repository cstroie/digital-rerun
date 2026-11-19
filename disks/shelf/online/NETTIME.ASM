;	NETTIME: the time from a clock on the net, over the modem
;
;	A>NETTIME		asks time.nist.gov (daytime, port 13)
;	A>NETTIME host[:port]	another clock that speaks NIST's daytime format
;	A>NETTIME +2		with an offset from UTC: +h, -h or +h:mm
;
;	It shows the time it is given (UTC) and how far this machine's clock
;	(port 20) is from it. Under CP/M 3 it sets the date and the time, UTC
;	and the offset, and says whether the BIOS kept them.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
conio	equ	6		;direct console I/O: E = 0FFh reads a key (A = 0: none)
print	equ	9
vers	equ	12
setdt	equ	104		;CP/M 3: set the date and time
getdt	equ	105		;CP/M 3: get them
clk	equ	20		;the clock port: OUT latches, IN reads the record
mst	equ	6		;modem status: bit 0 byte waiting, bit 1 may send, bit 2 carrier
mctl	equ	6		;modem control: bit 0 DTR
mdat	equ	7		;modem data
cr	equ	13
lf	equ	10
ring	equ	1000h		;what the modem brings: 1K above the program
rmask	equ	03h		;the offsets in the ring wrap at 0400h
mjd0	equ	43508		;the Modified Julian Day before CP/M's day 1 (1 Jan 1978)

	org	100h
	lxi	h,0
	dad	sp
	shld	savesp
	lxi	sp,stktop
	call	getarg
	call	args
	lxi	d,musage
	jc	quitm
	in	mst
	cpi	0ffh		;nothing answers: no modem here
	lxi	d,nomsg
	jz	quitm
	call	minit
	lxi	h,sask
	call	pz
	lhld	hostp
	call	phost
	lxi	h,sdots
	call	pz
	call	mdial
	jc	failed
	call	answer
	call	parse
	jc	unread
	call	showut
	call	showmc
	call	setcpm
	jmp	done
unread:	lxi	h,mbad
	call	pz
	lxi	h,abuf
	call	pline
failed:	call	pz
	lxi	h,scrlf
	call	pz
done:	call	mfini
exit:	lhld	savesp
	sphl
	ret
quitm:	mvi	c,print
	call	bdos
	jmp	exit

;	the words of CMDARG: an offset (+h, -h, +h:mm) into OFFS (minutes); anything else is
;	the host; the dial string into DIALBUF. CY set: a word that makes no sense
args:	lxi	h,0
	shld	offs
	lxi	h,deflt
	shld	hostp
	lxi	h,cmdarg
ar1:	mov	a,m
	ora	a
	jz	ar9
	cpi	' '
	jnz	ar2
	inx	h
	jmp	ar1
ar2:	cpi	'+'
	jz	aroff
	cpi	'-'
	jz	aroff
	shld	hostp		;a host: up to the next blank
ar3:	mov	a,m
	ora	a
	jz	ar9
	cpi	' '
	jz	ar4
	inx	h
	jmp	ar3
ar4:	mvi	m,0
	inx	h
	jmp	ar1
aroff:	mov	b,a		;the sign
	inx	h
	call	rdnum		;hours
	rc
	mov	a,d
	ora	a
	stc
	rnz
	mov	a,e
	cpi	15
	cmc
	rc
	push	b
	push	h
	lxi	h,0		;HL = hours * 60
	lxi	b,60
ar5:	ora	a
	jz	ar6
	dad	b
	dcr	a
	jmp	ar5
ar6:	xchg
	pop	h
	pop	b
	mov	a,m
	cpi	':'
	jnz	ar7
	inx	h
	push	d
	call	rdnum		;minutes
	mov	a,e
	pop	d
	rc
	cpi	60
	cmc
	rc
	add	e
	mov	e,a
	mvi	a,0
	adc	d
	mov	d,a
ar7:	mov	a,b
	cpi	'-'
	jnz	ar8
	mov	a,e		;negative: two's complement
	cma
	mov	e,a
	mov	a,d
	cma
	mov	d,a
	inx	d
ar8:	xchg
	shld	offs
	xchg
	jmp	ar1
ar9:	lhld	hostp
	lxi	d,sport
	call	mkdial
	ora	a
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

;	what the clock says, into ABUF (CR left out, 0-ended): until it hangs up, 15 seconds, or a key
answer:	lxi	h,abuf
	shld	aptr
	call	now
	shld	t0
an1:	call	poll
	call	rget
	jnc	an2
	in	mst
	ani	4
	jz	an9		;all here
	call	keyin
	ora	a
	jnz	an8
	call	elapsed
	lxi	d,15000
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jc	an1
an8:	call	hangup		;it says no more: enough
an9:	lhld	aptr
	mvi	m,0
	ret
an2:	cpi	cr
	jz	an1
	lhld	aptr
	lxi	d,abuf+250
	mov	b,a
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	jnc	an1
	mov	m,b
	inx	h
	shld	aptr
	jmp	an1

;	the first line of ABUF in NIST's form: JJJJJ YY-MM-DD HH:MM:SS. Into MJD, YY, MM, DD,
;	HH, MI, SS; CY set if there is none
parse:	lxi	h,abuf
pa1:	mov	a,m
	ora	a
	stc
	rz
	push	h
	call	tryl
	pop	h
	rnc
pa2:	mov	a,m		;the next line
	ora	a
	stc
	rz
	inx	h
	cpi	lf
	jnz	pa2
	jmp	pa1
tryl:	mov	a,m
	cpi	' '
	jnz	tr1
	inx	h
	jmp	tryl
tr1:	call	rdnum
	rc
	xchg
	shld	mjd
	xchg
	lxi	d,fields	;what comes next: a separator, then two digits, six times
	mvi	b,6
tr2:	ldax	d
	cmp	m
	stc
	rnz
	inx	h
	inx	d
	call	rd2
	rc
	push	h
	xchg
	mov	e,m		;where it goes
	inx	h
	mov	d,m
	inx	h
	stax	d
	xchg
	pop	h
	dcr	b
	jnz	tr2
	lhld	mjd		;a day after 1978 (a plausible clock)
	lxi	d,mjd0+1
	mov	a,l
	sub	e
	mov	a,h
	sbb	d
	ret
;	two decimal digits at HL: their value in A, HL after them; CY set if they are not
rd2:	mov	a,m
	sui	'0'
	rc
	cpi	10
	cmc
	rc
	mov	c,a
	add	a
	add	a
	add	c
	add	a
	mov	c,a
	inx	h
	mov	a,m
	sui	'0'
	rc
	cpi	10
	cmc
	rc
	add	c
	inx	h
	ora	a
	ret
fields:	db	' '
	dw	yy
	db	'-'
	dw	mm
	db	'-'
	dw	dd
	db	' '
	dw	hh
	db	':'
	dw	mi
	db	':'
	dw	ss

;	the line at HL (up to LF or 0) to the console
pline:	mov	a,m
	ora	a
	rz
	cpi	lf
	rz
	call	cout
	inx	h
	jmp	pline

;	host: 20YY-MM-DD HH:MM:SS UTC
showut:	lxi	h,scrlf
	call	pz
	lhld	hostp
	call	phost
	lxi	h,scolon
	call	pz
	lxi	h,s20
	call	pz
	lda	yy
	call	p2
	mvi	a,'-'
	call	cout
	lda	mm
	call	p2
	mvi	a,'-'
	call	cout
	lda	dd
	call	p2
	mvi	a,' '
	call	cout
	lda	hh
	call	p2
	mvi	a,':'
	call	cout
	lda	mi
	call	p2
	mvi	a,':'
	call	cout
	lda	ss
	call	p2
	lxi	h,sutc
	jmp	pz
phost:	mov	a,m		;the host, up to a colon or the end
	ora	a
	rz
	cpi	':'
	rz
	call	cout
	inx	h
	jmp	phost

;	A (0-99) in two digits
p2:	mvi	b,'0'
p21:	cpi	10
	jc	p22
	sui	10
	inr	b
	jmp	p21
p22:	push	psw
	mov	a,b
	call	cout
	pop	psw
	adi	'0'
	jmp	cout

;	HL in decimal
pnum:	lxi	d,10000
	call	pdig
	lxi	d,1000
	call	pdig
	lxi	d,100
	call	pdig
	lxi	d,10
	call	pdig
	mov	a,l
	adi	'0'
	jmp	cout
pdig:	mvi	b,'0'-1		;the digit of HL in DE's place (a leading 0 is left out)
pd1:	inr	b
	mov	a,l
	sub	e
	mov	l,a
	mov	a,h
	sbb	d
	mov	h,a
	jnc	pd1
	dad	d
	mov	a,b
	cpi	'0'
	jnz	pd2
	lda	lead
	ora	a
	rz
pd2:	sta	lead
	mov	a,b
	jmp	cout

;	a BCD byte (A) in two digits
pbcd:	push	psw
	rrc
	rrc
	rrc
	rrc
	ani	0fh
	adi	'0'
	call	cout
	pop	psw
	ani	0fh
	adi	'0'
	jmp	cout

;	this machine's clock (port 20) and how far it is from the clock asked
showmc:	lxi	h,smach
	call	pz
	xra	a
	out	clk
	in	clk
	cpi	1
	lxi	h,mnoclk
	jnz	pz
	in	clk
	sta	mdays
	in	clk
	sta	mdays+1
	in	clk
	sta	mhh
	in	clk
	sta	mmi
	in	clk
	sta	mss
	in	clk
	sta	myear
	in	clk
	sta	myear+1
	in	clk
	sta	mmon
	in	clk
	sta	mday
	lhld	myear
	xra	a
	sta	lead
	call	pnum		;the year
	mvi	a,'-'
	call	cout
	lda	mmon
	call	p2
	mvi	a,'-'
	call	cout
	lda	mday
	call	p2
	mvi	a,' '
	call	cout
	lda	mhh
	call	pbcd
	mvi	a,':'
	call	cout
	lda	mmi
	call	pbcd
	mvi	a,':'
	call	cout
	lda	mss
	call	pbcd
	lxi	h,scomma
	call	pz
;	the two instants in seconds since 1978, and their difference
	lhld	mdays
	shld	days
	lda	mhh
	call	unbcd
	sta	th
	lda	mmi
	call	unbcd
	sta	tm
	lda	mss
	call	unbcd
	sta	ts
	call	instant
	lxi	h,tmach
	lxi	d,acc
	call	copy4
	call	utcin
	lxi	h,tmach		;ACC = machine - UTC
	lxi	d,acc
	call	sub4
	lda	acc+3
	ora	a
	lxi	h,sahead
	jp	mc1
	lxi	h,acc		;negative: behind
	call	neg4
	lxi	h,sbehind
mc1:	shld	w1
	lxi	h,acc		;equal: a second or less
	call	zero4
	lxi	h,msame
	jz	mc9
	lda	acc+3		;more than a day: say so
	ora	a
	jnz	mc8
	lda	acc+2
	cpi	2		;86400 = 15180h
	jnc	mc8
	lxi	b,60		;h:mm:ss
	call	div4
	sta	ts
	lxi	b,60
	call	div4
	sta	tm
	lda	acc
	sta	th
	mov	l,a
	mvi	h,0
	xra	a
	sta	lead
	call	pnum
	mvi	a,':'
	call	cout
	lda	tm
	call	p2
	mvi	a,':'
	call	cout
	lda	ts
	call	p2
	lhld	w1
	jmp	mc9
mc8:	lxi	h,mfar
mc9:	call	pz
	lxi	h,scrlf
	jmp	pz

;	the UTC instant (MJD and HH:MM:SS) into ACC; DAYS, TH, TM, TS set
utcin:	lhld	mjd
	lxi	d,-mjd0
	dad	d
	shld	days
	lda	hh
	sta	th
	lda	mi
	sta	tm
	lda	ss
	sta	ts
;	DAYS * 86400 + TH * 3600 + TM * 60 + TS into ACC
instant:lxi	h,acc
	call	clr4
	lhld	days
	lxi	b,k86400
	call	macc
	lda	th
	mov	l,a
	mvi	h,0
	lxi	b,k3600
	call	macc
	lda	tm
	mov	l,a
	mvi	h,0
	lxi	b,k60
	call	macc
	lda	ts
	mov	l,a
	mvi	h,0
	lxi	b,k1
	jmp	macc

;	ACC = ACC + HL * the 4 bytes at BC
macc:	shld	mulv
	lxi	h,mk
	mov	d,b
	mov	e,c
	call	copy4
mc2:	lhld	mulv
	mov	a,h
	ora	l
	rz
	ora	a		;HL >> 1, the bit out in CY
	mov	a,h
	rar
	mov	h,a
	mov	a,l
	rar
	mov	l,a
	shld	mulv
	jnc	mc3
	lxi	h,mk
	lxi	d,acc
	call	add4
mc3:	lxi	h,mk		;MK = MK * 2
	lxi	d,mk
	call	add4
	jmp	mc2

;	the 4 bytes at DE += the 4 bytes at HL (both kept)
add4:	push	h
	push	d
	mvi	c,4
	ora	a
ad1:	ldax	d
	adc	m
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	ad1
	pop	d
	pop	h
	ret
;	the 4 bytes at HL less the 4 bytes at DE, into the 4 bytes at DE
sub4:	push	h
	push	d
	mvi	c,4
	ora	a
sb1:	mov	a,m
	xchg
	sbb	m
	xchg
	stax	d
	inx	h
	inx	d
	dcr	c
	jnz	sb1
	pop	d
	pop	h
	ret
;	the 4 bytes at HL negated
neg4:	push	h
	mvi	c,4
	ora	a
ng1:	mvi	a,0
	sbb	m
	mov	m,a
	inx	h
	dcr	c
	jnz	ng1
	pop	h
	ret
;	Z set if the 4 bytes at HL are 0
zero4:	mov	a,m
	inx	h
	ora	m
	inx	h
	ora	m
	inx	h
	ora	m
	ret
clr4:	xra	a
	mov	m,a
	inx	h
	mov	m,a
	inx	h
	mov	m,a
	inx	h
	mov	m,a
	ret
;	4 bytes from DE to HL
copy4:	mvi	c,4
cy1:	ldax	d
	mov	m,a
	inx	h
	inx	d
	dcr	c
	jnz	cy1
	ret
;	ACC = ACC / BC (BC < 8000h); the remainder in HL, its low byte in A
div4:	mov	h,b
	mov	l,c
	shld	dvs
	lxi	h,0
	shld	rem
	mvi	b,32
dv1:	lxi	h,acc		;ACC << 1, its top bit out in CY
	mvi	c,4
	ora	a
dv2:	mov	a,m
	ral
	mov	m,a
	inx	h
	dcr	c
	jnz	dv2
	lhld	rem		;REM = REM * 2 + that bit
	mov	a,l
	ral
	mov	l,a
	mov	a,h
	ral
	mov	h,a
	xchg
	lhld	dvs
	xchg
	mov	a,l		;REM >= the divisor: take it away, a 1 into ACC
	sub	e
	mov	c,a
	mov	a,h
	sbb	d
	jc	dv3
	mov	h,a
	mov	l,c
	lda	acc
	ori	1
	sta	acc
dv3:	shld	rem
	dcr	b
	jnz	dv1
	mov	a,l
	ret

;	A in BCD to binary, and back
unbcd:	push	b
	mov	b,a
	ani	0f0h
	rrc
	mov	c,a		;tens * 8
	rrc
	rrc			;tens * 2
	add	c
	mov	c,a
	mov	a,b
	ani	0fh
	add	c
	pop	b
	ret
tobcd:	push	b
	mvi	b,0
tb2:	cpi	10
	jc	tb3
	sui	10
	inr	b
	jmp	tb2
tb3:	mov	c,a
	mov	a,b
	rlc
	rlc
	rlc
	rlc
	ora	c
	pop	b
	ret

;	CP/M 3: the date and the time set (UTC and the offset), and read back to see if they stayed
setcpm:	mvi	c,vers
	call	bdos
	mov	a,l
	cpi	30h
	rc			;CP/M 2: it has no date
	call	utcin		;ACC = the UTC instant in seconds
	lxi	b,60
	call	div4		;ACC = minutes
	lhld	offs		;and the offset, its sign spread over 4 bytes
	shld	off4
	mov	a,h
	ral
	sbb	a
	sta	off4+2
	sta	off4+3
	lxi	h,off4
	lxi	d,acc
	call	add4
	lxi	b,1440
	call	div4		;ACC = the day, HL = the minute of it
	mvi	b,0
sc1:	mov	a,l		;HL / 60: hours in B, minutes in L
	sui	60
	mov	c,a
	mov	a,h
	sbi	0
	jc	sc2
	mov	h,a
	mov	l,c
	inr	b
	jmp	sc1
sc2:	mov	a,l
	call	tobcd
	sta	dat+3
	mov	a,b
	call	tobcd
	sta	dat+2
	lhld	acc
	shld	dat
	lxi	d,dat
	mvi	c,setdt
	call	bdos
	lxi	d,dat2
	mvi	c,getdt
	call	bdos
	lxi	h,dat		;the same day, hour and minute: it stayed
	lxi	d,dat2
	mvi	b,4
sc3:	ldax	d
	cmp	m
	jnz	sc9
	inx	h
	inx	d
	dcr	b
	jnz	sc3
	lxi	h,mset
	call	pz
	lda	dat+2
	call	pbcd
	mvi	a,':'
	call	cout
	lda	dat+3
	call	pbcd
	lxi	h,mset2
	call	pz
	lhld	offs
	mov	a,h
	ora	l
	jz	sc4
	mov	a,h
	ora	a
	mvi	a,'+'
	jp	sc5
	mvi	a,'-'
	push	psw
	mov	a,l
	cma
	mov	l,a
	mov	a,h
	cma
	mov	h,a
	inx	h
	pop	psw
sc5:	call	cout
	mvi	b,0		;minutes into hours and minutes
sc6:	mov	a,l
	sui	60
	mov	c,a
	mov	a,h
	sbi	0
	jc	sc7
	mov	h,a
	mov	l,c
	inr	b
	jmp	sc6
sc7:	push	h
	mov	l,b
	mvi	h,0
	xra	a
	sta	lead
	call	pnum
	pop	h
	mov	a,l
	ora	a
	jz	sc4
	mvi	a,':'
	call	cout
	mov	a,l
	call	p2
sc4:	lxi	h,mset3
	jmp	pz
sc9:	lxi	h,mkeeps
	jmp	pz

;	---- the modem (the same in FINGER, NETTIME, GOPHER, MUD and GEMINI) ----

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
musage:	db	'NETTIME [host[:port]] [+h | -h | +h:mm]  (the offset from'
	db	' UTC)',cr,lf,'$'
mcancel:db	'Given up.',0
mnoans:	db	'No answer.',0
mbad:	db	'Not a time I can read: ',0
mnoclk:	db	'no clock.',cr,lf,0
msame:	db	'the same, to the second.',0
mfar:	db	'more than a day apart.',0
mset:	db	'CP/M 3 clock set: ',0
mset2:	db	' UTC',0
mset3:	db	'.',cr,lf,0
mkeeps:	db	'The BIOS keeps its own clock: CP/M 3 was not set.',cr,lf,0
sask:	db	'Asking ',0
sdots:	db	' ...',cr,lf,0
scolon:	db	': ',0
s20:	db	'20',0
sutc:	db	' UTC',cr,lf,0
smach:	db	'This machine: ',0
scomma:	db	', ',0
sahead:	db	' ahead.',0
sbehind:db	' behind.',0
scrlf:	db	cr,lf,0
sport:	db	':13',0
deflt:	db	'time.nist.gov',0
sate0:	db	'ATE0',cr,0
sate1:	db	'ATE1',cr,0
k86400:	dw	5180h,1
k3600:	dw	3600,0
k60:	dw	60,0
k1:	dw	1,0
rhead:	dw	0
rtail:	dw	0
t0:	dw	0
tlim:	dw	0
lptr:	dw	0
savesp:	dw	0
hostp:	dw	0
offs:	dw	0
aptr:	dw	0
mjd:	dw	0
days:	dw	0
mdays:	dw	0
myear:	dw	0
w1:	dw	0
mulv:	dw	0
dvs:	dw	0
rem:	dw	0
yy:	db	0
mm:	db	0
dd:	db	0
hh:	db	0
mi:	db	0
ss:	db	0
th:	db	0
tm:	db	0
ts:	db	0
mhh:	db	0
mmi:	db	0
mss:	db	0
mmon:	db	0
mday:	db	0
lead:	db	0
acc:	ds	4
tmach:	ds	4
mk:	ds	4
off4:	ds	4
dat:	ds	4
dat2:	ds	5
dialbuf:db	'ATDT'
	ds	72
lbuf:	ds	80
cmdarg:	ds	72
abuf:	ds	256
	ds	128
stktop	equ	$
	end
