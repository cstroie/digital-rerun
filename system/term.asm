;	TERM: a terminal for the modem port
;
;	What is typed goes out of the modem (ports 6 and 7), what comes in goes
;	to the screen. Talk to the modem in AT commands: ATDT then a number.
;	Ctrl-] is the escape: Q quits (the call stays up, run TERM again to
;	come back), H hangs up, ^] sends a Ctrl-], ? helps. A>TERM
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

bdos	equ	0005h
conio	equ	6		;direct console I/O: E = 0FFh reads a key (A = 0: none)
print	equ	9
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
	mvi	e,0ffh
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
	lxi	d,prompt
	mvi	c,print
	call	bdos
cmd1:	mvi	c,1		;a key, with echo
	call	bdos
	ani	5fh		;upper case
	cpi	'Q'
	jz	quit
	cpi	'H'
	jz	hang
	cpi	esc & 5fh
	jz	sendesc
	lxi	d,helpmsg
	mvi	c,print
	call	bdos
	jmp	loop
sendesc:
	mvi	a,esc
	sta	pend
	jmp	loop
hang:	xra	a		;DTR down and up again
	out	mctl
	mvi	a,1
	out	mctl
	lxi	d,hungup
	mvi	c,print
	call	bdos
	jmp	loop
quit:	lxi	d,crlf
	mvi	c,print
	call	bdos
	ret

pend:	db	0		;a key waiting for the transmitter
nomsg:	db	'No modem on this machine.',cr,lf,'$'
hello:	db	'TERM: Ctrl-] for commands. Try ATDT and a number.',cr,lf,'$'
prompt:	db	cr,lf,'[Q quit, H hang up, ? help] $'
helpmsg:db	cr,lf,'Q quits (the call stays up), H hangs up, Ctrl-] twice sends one.',cr,lf,'$'
hungup:	db	cr,lf,'Hung up.',cr,lf,'$'
crlf:	db	cr,lf,'$'
	end
