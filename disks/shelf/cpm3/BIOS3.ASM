;	DigitalRerun BIOS for CP/M 3 (CP/M Plus), non-banked, 64K
;
;	The BIOS of the DigitalRerun machine for CP/M 3: console, printer,
;	paper tape and the disk controller on I/O ports (the disk ports are
;	z80pack's, as in system/bios.asm). Drives A: to D: take 8" single
;	density disks and three 5 1/4" double density formats (the
;	controller reports which), I: a 4 MB hard disk. The controller
;	moves 128-byte records, so the BDOS needs no sector blocking.
;
;	8080 code, assembled with RMAC and linked with LINK as BIOS3.SPR
;	(tools/build-cpm3.js does it inside the machine, as GEN.SUB does on
;	the disk): RMAC BIOS3, LINK BIOS3[OS]=BIOS3,SCB, GENCPM.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.


;	I/O ports
cons	equ	0		;console status: 0FFh when a key waits
cond	equ	1		;console data
prts	equ	2		;printer status: 0FFh when ready
prtd	equ	3		;printer data
rdrd	equ	4		;paper tape reader: next byte, 1Ah at the end
pund	equ	5		;paper tape punch
mst	equ	6		;modem status: bit 0 byte waiting, bit 1 may send, 0FFh no modem
mdat	equ	7		;modem data
fdcd	equ	10		;drive; IN: 0FFh when it holds a disk
fdct	equ	11		;track
fdcs	equ	12		;sector, low byte
fdcsh	equ	17		;sector, high byte
fdcop	equ	13		;command: 0 read, 1 write
fdcst	equ	14		;status: 0 ok
dmal	equ	15		;DMA address, low byte
dmah	equ	16		;DMA address, high byte
fdcfmt	equ	18		;IN: format of the selected drive's disk
clk	equ	20		;OUT: latch the date and time; IN: the next byte of it

bootram	equ	0000h
bdos	equ	0005h
ccp	equ	0100h		;the CCP is loaded into the TPA
cr	equ	13
lf	equ	10
getch	equ	1		;BDOS functions
print	equ	9
open	equ	15
readseq	equ	20
dma	equ	26
multisec equ	44

mb$input	equ	01h	;device may do input
mb$output	equ	02h	;device may do output
mb$in$out	equ	03h
mb$serial	equ	08h
baud$none	equ	0
baud$1200	equ	8

	extrn	@civec, @covec, @aivec, @aovec, @lovec, @mxtpa
	extrn	@date, @hour, @min, @sec

	cseg

;	jump table
	jmp boot	;cold start
warmpt:	jmp wboot	;warm start
	jmp const	;console input status
	jmp conin	;console character in
	jmp conout	;console character out
	jmp list	;list character out
	jmp auxout	;aux character out
	jmp auxin	;aux character in
	jmp home	;move to track 0
	jmp seldsk	;select disk
	jmp settrk	;set track
	jmp setsec	;set sector
	jmp setdma	;set DMA address
	jmp read	;read sector
	jmp write	;write sector
	jmp listst	;list status
	jmp sectrn	;sector translate
	jmp conost	;console output status
	jmp auxist	;aux input status
	jmp auxost	;aux output status
	jmp devtbl	;character device table
	jmp devini	;initialise a character device
	jmp drvtbl	;disk drive table
	jmp multio	;multi-sector count
	jmp flush	;flush buffers
	jmp move	;memory to memory
	jmp time	;time and date
	jmp selmem	;select bank
	jmp setbnk	;set bank for DMA
	jmp xmove	;set banks for a move
	jmp 0	;reserved
	jmp 0
	jmp 0

;	cold start: CON for the console, LPT for the list device, PTR and PTP for aux
boot:	lxi h,8000h
	shld @civec
	shld @covec
	lxi h,4000h
	shld @lovec
	lxi h,2000h
	shld @aivec
	lxi h,1000h
	shld @aovec
	mvi b,1	;1: say hello
	jmp wboot1

;	warm start: page zero again, then the CCP from CCP.COM on A:
wboot:	mvi b,0
wboot1:	lxi sp,bstack
	lxi h,warmpt
	shld bootram+1
	lhld @mxtpa
	shld bdos+1
	mvi a,0c3h
	sta bootram
	sta bdos
	mov a,b
	ora a
	jz ldccp
	lxi d,signon
	call printf
ldccp:	xra a
	sta ccpfcb+15	;extent 0
	lxi h,0
	shld fcbnr	;from the start
	lxi d,ccpfcb
	mvi c,open
	call bdos
	lxi d,opnmsg
	inr a
	jz prterr
	lxi d,ccp
	mvi c,dma
	call bdos
	lxi d,128
	mvi c,multisec
	call bdos	;up to 16K at once
	lxi d,ccpfcb
	mvi c,readseq
	call bdos
	lxi d,iomsg
	inr a
	jnz ccp
prterr:	call printf
	mvi c,getch
	call bdos
	jmp boot
printf:	mvi c,print
	jmp bdos

	ds	16
bstack:

ccpfcb:	db	1,'CCP     ','COM',0,0,0,0
	ds	16
fcbnr:	ds	3
signon:	db	cr,lf,'DigitalRerun 64K CP/M 3.0',cr,lf,'$'
opnmsg:	db	cr,lf,'BIOS error: CCP.COM is not on A:',cr,lf,'$'
iomsg:	db	cr,lf,'BIOS error: CCP.COM does not read',cr,lf,'$'

;	console and other character devices: 0 CRT, 1 LPT, 2 PTR, 3 PTP;
;	a vector has bit 15 for device 0, bit 14 for device 1 ...
devtbl:	lxi h,ctbla
	ret
devini:	ret
ctbla:	db	'CRT   ',mb$in$out,baud$none
	db	'LPT   ',mb$output,baud$none
	db	'PTR   ',mb$input,baud$none
	db	'PTP   ',mb$output,baud$none
	db	'MODEM ',mb$in$out+mb$serial,baud$1200
	db	0

conout:	lhld @covec
	jmp out$scan
auxout:	lhld @aovec
	jmp out$scan
list:	lhld @lovec
out$scan:
	mvi b,0
co$next:
	dad h
	jnc not$out
	push h
	push b
	call ?co
	pop b
	pop h
not$out:
	inr b
	mov a,h
	ora l
	jnz co$next
	ret

conost:	lhld @covec
	jmp ost$scan
auxost:	lhld @aovec
	jmp ost$scan
listst:	lhld @lovec
ost$scan:
	mvi b,0
cos$next:
	dad h
	jnc not$ost
	push h
	push b
	call ?cost
	pop b
	pop h
	ora a
	rz	;one is not ready
not$ost:
	inr b
	mov a,h
	ora l
	jnz cos$next
	mvi a,0ffh
	ret

const:	lhld @civec
	jmp ist$scan
auxist:	lhld @aivec
ist$scan:
	mvi b,0
cis$next:
	dad h
	jnc not$ist
	push h
	push b
	call ?cist
	pop b
	pop h
	ora a
	rnz	;one has a character
not$ist:
	inr b
	mov a,h
	ora l
	jnz cis$next
	xra a
	ret

conin:	lhld @civec
	jmp in$scan
auxin:	lhld @aivec
in$scan:
	mov a,h
	ora l
	jnz in$some
	mvi a,1ah	;no device: end of file
	ret
in$some:
	push h
	mvi b,0
ci$next:
	dad h
	jnc not$in
	push h
	push b
	call ?cist
	pop b
	pop h
	ora a
	jz not$in
	pop d	;the vector
	jmp ?ci
not$in:
	inr b
	mov a,h
	ora l
	jnz ci$next
	pop h
	jmp in$scan	;none yet: look again

;	device B: character in
?ci:	mov a,b
	ora a
	jz ci0
	cpi 2
	jz ci2
	cpi 4
	jz ci4
	mvi a,1ah
	ret
ci0:	in cons
	ora a
	jz ci0
	in cond
	ani 7fh
	ret
ci2:	in rdrd	;1Ah when the tape has run out
	ret
ci4:	in mst	;the modem: wait for a byte
	cpi 0ffh
	jz ci4n	;no modem: end of file
	ani 1
	jz ci4
	in mdat
	ret
ci4n:	mvi a,1ah
	ret

;	device B: input ready?
?cist:	mov a,b
	ora a
	jz cist0
	cpi 4
	jz cist4
	cpi 2
	mvi a,0ffh
	rz
	xra a
	ret
cist4:	in mst	;a byte waiting?
	cpi 0ffh
	jz cist4n
	ani 1
	rz
	mvi a,0ffh
	ret
cist4n:	xra a
	ret
cist0:	in cons
	ret

;	device B: character C out
?co:	mov a,b
	ora a
	jz co0
	cpi 1
	jz co1
	cpi 4
	jz co4
	cpi 3
	rnz
	mov a,c
	out pund
	ret
co4:	in mst	;the modem: wait until it may send
	cpi 0ffh
	rz	;no modem: the byte goes nowhere
	ani 2
	jz co4
	mov a,c
	out mdat
	ret
co0:	mov a,c
	out cond
	ret
co1:	in prts	;wait while off line
	ora a
	jz co1
	mov a,c
	out prtd
	ret

;	device B: output ready?
?cost:	mov a,b
	cpi 1
	jz cost1
	cpi 4
	jz cost4
	mvi a,0ffh
	ret
cost4:	in mst	;may it send?
	cpi 0ffh
	jz cost4n
	ani 2
	rz
	mvi a,0ffh
	ret
cost4n:	mvi a,0ffh	;no modem: output is always ready (and goes nowhere)
	ret
cost1:	in prts
	ret

;	disks. DRVTBL lists the DPHs of A: to P:
drvtbl:	lxi h,dtbla
	ret
dtbla:	dw	dph0,dph1,dph2,dph3,0,0,0,0
	dw	dphi,0,0,0,0,0,0,0

;	disk parameter headers: translate table, 9 bytes of BDOS scratch, media
;	flag, DPB, checksum vector, allocation vector, directory BCB, data
;	BCB, hash table, hash bank. FFFEh: GENCPM allocates it; FFFFh: not used
dph0:	dw	trans
	db	0,0,0,0,0,0,0,0,0,0
	dw	dpb8,0fffeh,0fffeh,0fffeh,0ffffh,0ffffh
	db	0
dph1:	dw	trans
	db	0,0,0,0,0,0,0,0,0,0
	dw	dpb8,0fffeh,0fffeh,0fffeh,0ffffh,0ffffh
	db	0
dph2:	dw	trans
	db	0,0,0,0,0,0,0,0,0,0
	dw	dpb8,0fffeh,0fffeh,0fffeh,0ffffh,0ffffh
	db	0
dph3:	dw	trans
	db	0,0,0,0,0,0,0,0,0,0
	dw	dpb8,0fffeh,0fffeh,0fffeh,0ffffh,0ffffh
	db	0
dphi:	dw	0
	db	0,0,0,0,0,0,0,0,0,0
	dw	dpbhd,0fffeh,0fffeh,0fffeh,0ffffh,0ffffh
	db	0

;	8" SSSD: 77 tracks of 26 sectors, 1K blocks, 2 system tracks
dpb8:	dw	26		;128-byte records per track
	db	3,7,0		;block shift, mask, extent mask
	dw	242,63		;highest block, highest directory entry
	db	0c0h,0		;directory blocks
	dw	16,2		;check size, system tracks
	db	0,0		;sector size 128

;	5 1/4" SSDD, 40 tracks of 10 x 512 bytes, 1K blocks, 1 system track
dpbs5:	dw	40
	db	3,7,0
	dw	194,63
	db	0c0h,0
	dw	16,1
	db	0,0

;	5 1/4" DSDD, 80 tracks of 10 x 512 bytes, 2K blocks, 1 system track
dpbd5:	dw	40
	db	4,15,1
	dw	196,63
	db	080h,0
	dw	16,1
	db	0,0

;	5 1/4" SSDD, 40 tracks of 5 x 1024 bytes, 1K blocks, 3 system tracks
dpbk5:	dw	40
	db	3,7,0
	dw	184,63
	db	0c0h,0
	dw	16,3
	db	0,0

;	4 MB hard disk: 255 tracks of 128 sectors, 2K blocks, fixed
dpbhd:	dw	128
	db	4,15,0
	dw	2039,1023
	db	0ffh,0ffh
	dw	8000h,0
	db	0,0

;	by format (IN fdcfmt): skew table, DPB. The controller places the
;	5 1/4" records itself, so they need no table.
fmttab:	dw	trans,dpb8
	dw	0,dpbs5
	dw	0,dpbd5
	dw	0,dpbk5
nfmts	equ	4

;	sector skew 6, the standard for 8" disks
trans:	db	1,7,13,19,25,5,11,17,23,3,9,15,21
	db	2,8,14,20,26,6,12,18,24,4,10,16,22

;	select drive C: HL = its DPH, or 0 when there is none or no disk in it
seldsk:	mov a,c
	cpi 16
	jnc selno
	mov l,c
	mvi h,0
	dad h
	lxi d,dtbla
	dad d
	mov e,m
	inx h
	mov d,m	;DE = DPH
	mov a,d
	ora e
	jz selno
	mov a,c
	out fdcd
	in fdcd	;a disk in it?
	ora a
	jz selno
	mov a,c
	cpi 8
	jz seldone	;the hard disk is what it is
	in fdcfmt	;which format is the disk?
	cpi nfmts
	jnc selno
	push d
	add a
	add a	;4 bytes an entry
	mov l,a
	mvi h,0
	lxi b,fmttab
	dad b
	mov c,m
	inx h
	mov b,m	;BC = its skew table
	inx h
	mov e,m
	inx h
	mov d,m	;DE = its DPB
	pop	h		;HL = DPH
	push	h
	mov	m,c
	inx	h
	mov	m,b
	push	d
	lxi	d,11
	dad	d
	pop	d
	mov	m,e
	inx	h
	mov	m,d
	pop	h
	ret
seldone:
	xchg
	ret
selno:	lxi h,0
	ret

home:	mvi c,0
settrk:	mov a,c
	out fdct
	ret

setsec:	mov a,c
	out fdcs
	mov a,b
	out fdcsh
	ret

setdma:	mov a,c
	out dmal
	mov a,b
	out dmah
	ret

read:	xra a
	jmp rwop
write:	mvi a,1
rwop:	out fdcop
	in fdcst
	ora a
	rz
	mvi a,1	;permanent error
	ret

;	logical sector BC (from 0) to the controller's (from 1) through the table at DE
sectrn:	mov a,d
	ora e
	jz notran
	xchg
	dad b
	mov l,m
	mvi h,0
	ret
notran:	mov h,b
	mov l,c
	inx h
	ret

;	the rest has nothing to do on this machine
multio:
selmem:
setbnk:
xmove:
	ret

;	time and date: the host's, from the clock port (js/devices/clock.js)
time:	mov a,c
	ora a
	rnz		;setting the clock: it is the host's
	out clk		;latch: status 1, days, hour, minute, second (BCD)
	in clk
	cpi 1
	rnz		;no clock port: the date stays what it was
	in clk
	sta @date
	in clk
	sta @date+1
	in clk
	sta @hour
	in clk
	sta @min
	in clk
	sta @sec
	ret
flush:	xra a
	ret

;	copy BC bytes from DE to HL; leave HL and DE after the ends
move:	xchg
	mov	a,b
mv1:	ora	c
	jz	mv2
	mov	a,m
	stax	d
	inx	h
	inx	d
	dcx	b
	mov	a,b
	jmp	mv1
mv2:
	xchg
	ret

	end
