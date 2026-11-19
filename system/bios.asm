;	DigitalRerun BIOS for CP/M 2.2, 64K
;
;	A small BIOS for the DigitalRerun machine: console, printer and disk
;	controller on I/O ports (the disk ports are z80pack's). Drives
;	A: to D: take 8" single density disks and three 5 1/4" double
;	density formats (the controller reports which), I: a 4 MB hard
;	disk. 8080 code in the syntax of CP/M's ASM.COM, so it can be
;	changed and assembled inside CP/M as well as by tools/build.js.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

msize	equ	64		;memory size in Kbytes
ccp	equ	(msize-7)*1024	;base of CCP: 0E400h for 64K
bdos	equ	ccp+806h	;BDOS entry
bios	equ	ccp+1600h	;base of this BIOS
nsects	equ	44		;CCP + BDOS: 16 + 28 sectors

iobyte	equ	0003h		;I/O byte
cdisk	equ	0004h		;current user (high nibble) and disk
buff	equ	0080h		;default DMA buffer

;	I/O ports
cons	equ	0		;console status: 0FFh when a key waits
cond	equ	1		;console data
prts	equ	2		;printer status: 0FFh when ready
prtd	equ	3		;printer data
rdrd	equ	4		;paper tape reader: next byte, 1Ah at the end
pund	equ	5		;paper tape punch
mstat	equ	6		;the modem: IN bit 0 a byte waits, bit 1 it may send (bit 2 carrier)
mdat	equ	7		;the modem's data
;	the I/O byte (location 3): CON: UC1: (3) is the modem, RDR: UR1: (2), PUN: UP1: (2) and LST: UL1: (3) too
ucon	equ	3		;CON: bits 0-1
urdr	equ	08h		;RDR: bits 2-3 = 2
upun	equ	20h		;PUN: bits 4-5 = 2
ulst	equ	0c0h		;LST: bits 6-7 = 3 (UL1:) the modem too
fdcd	equ	10		;drive; IN: 0FFh when it holds a disk
fdct	equ	11		;track
fdcs	equ	12		;sector, low byte
fdcsh	equ	17		;sector, high byte
fdcop	equ	13		;command: 0 read, 1 write
fdcst	equ	14		;status: 0 ok
dmal	equ	15		;DMA address, low byte
dmah	equ	16		;DMA address, high byte
fdcfmt	equ	18		;IN: format of the selected drive's disk

	org	bios

;	jump vector
	jmp	boot		;cold start
wboote:	jmp	wboot		;warm start
	jmp	const		;console status
	jmp	conin		;console character in
	jmp	conout		;console character out
	jmp	list		;list character out
	jmp	punch		;punch character out
	jmp	reader		;reader character in
	jmp	home		;move head to home position
	jmp	seldsk		;select disk
	jmp	settrk		;set track number
	jmp	setsec		;set sector number
	jmp	setdma		;set DMA address
	jmp	read		;read disk
	jmp	write		;write disk
	jmp	listst		;list status
	jmp	sectran		;sector translate

;	disk parameter headers: A: to D:, then I:
dpbase:	dw	trans,0,0,0,dirbuf,dpb8,csv0,alv0
	dw	trans,0,0,0,dirbuf,dpb8,csv1,alv1
	dw	trans,0,0,0,dirbuf,dpb8,csv2,alv2
	dw	trans,0,0,0,dirbuf,dpb8,csv3,alv3
dphi:	dw	0,0,0,0,dirbuf,dpbhd,0,alvi

;	8" SSSD: 77 tracks of 26 sectors, 1K blocks, 2 system tracks
dpb8:	dw	26		;sectors per track
	db	3		;block shift: 1K blocks
	db	7		;block mask
	db	0		;extent mask
	dw	242		;highest block number
	dw	63		;highest directory entry
	db	0c0h,0		;directory blocks
	dw	16		;directory check size
	dw	2		;system tracks

;	5 1/4" SSDD, 40 tracks of 10 x 512 bytes, 1K blocks, 1 system track
dpbs5:	dw	40		;128-byte records per track
	db	3,7,0		;1K blocks
	dw	194		;highest block number
	dw	63
	db	0c0h,0
	dw	16
	dw	1

;	5 1/4" DSDD, 80 tracks of 10 x 512 bytes, 2K blocks, 1 system track
dpbd5:	dw	40
	db	4,15,1		;2K blocks
	dw	196
	dw	63
	db	080h,0
	dw	16
	dw	1

;	5 1/4" SSDD, 40 tracks of 5 x 1024 bytes, 1K blocks, 3 system tracks
dpbk5:	dw	40
	db	3,7,0
	dw	184
	dw	63
	db	0c0h,0
	dw	16
	dw	3

;	by format (IN fdcfmt): skew table, DPB. The controller places the
;	5 1/4" records itself, so they need no table.
fmttab:	dw	trans,dpb8
	dw	0,dpbs5
	dw	0,dpbd5
	dw	0,dpbk5
nfmts	equ	4

;	4 MB hard disk: 255 tracks of 128 sectors, 2K blocks
dpbhd:	dw	128		;sectors per track
	db	4		;block shift: 2K blocks
	db	15		;block mask
	db	0		;extent mask
	dw	2039		;highest block number
	dw	1023		;highest directory entry
	db	0ffh,0ffh	;directory blocks
	dw	0		;fixed disk: no check
	dw	0		;no system tracks

;	sector skew 6, the standard for 8" disks
trans:	db	1,7,13,19,25,5,11,17,23,3,9,15,21
	db	2,8,14,20,26,6,12,18,24,4,10,16,22

signon:	db	13,10,'DigitalRerun 64K CP/M 2.2',13,10,0

;	cold start
boot:	lxi	sp,buff
	xra	a		;first: the byte is the boot sector's code until now, the console is the terminal
	sta	iobyte
	lxi	h,signon
	call	prmsg
	xra	a
	sta	cdisk
	jmp	gocpm

;	warm start: load CCP and BDOS again from the system tracks of A:
wboot:	lxi	sp,buff		;the I/O byte is kept, as CP/M keeps it (STAT sets it for later commands)
	xra	a
	out	fdcd
	out	fdcsh
	mov	e,a		;track 0
	lxi	h,ccp
	mvi	b,2		;first sector
	mvi	c,nsects
wbloop:	mov	a,e
	out	fdct
	mov	a,b
	out	fdcs
	mov	a,l
	out	dmal
	mov	a,h
	out	dmah
	xra	a
	out	fdcop
	in	fdcst
	ora	a
	jnz	wboot		;retry until it reads
	push	d
	lxi	d,128
	dad	d
	pop	d
	dcr	c
	jz	gocpm
	inr	b
	mov	a,b
	cpi	27
	jc	wbloop
	mvi	b,1
	inr	e
	jmp	wbloop

;	set up page zero and enter the CCP
gocpm:	mvi	a,0c3h		;JMP
	sta	0
	lxi	h,wboote
	shld	1
	sta	5
	lxi	h,bdos
	shld	6
	lxi	b,buff
	call	setdma
	lda	cdisk		;drive still there?
	ani	0fh
	mov	c,a
	call	seldsk
	mov	a,h
	ora	l
	jnz	gocpm1
	lda	cdisk		;no: back to A:, same user
	ani	0f0h
	sta	cdisk
gocpm1:	lda	cdisk
	mov	c,a
	jmp	ccp

;	print the zero-terminated string at HL
prmsg:	mov	a,m
	ora	a
	rz
	mov	c,a
	call	conout
	inx	h
	jmp	prmsg

;	console: the physical one, or the modem when the I/O byte says UC1:
const:	lda	iobyte
	ani	3
	cpi	ucon
	jz	mconst
	in	cons		;0FFh when a key waits, else 0
	ret

conin:	lda	iobyte
	ani	3
	cpi	ucon
	jz	mconin
	in	cons
	ora	a
	jz	conin
	in	cond
	ani	7fh
	ret

conout:	lda	iobyte
	ani	3
	cpi	ucon
	jz	mconout
	mov	a,c
	out	cond
	ret

;	the modem (ports 6 and 7) as a character device: a byte waits when status bit 0 is set, a byte
;	may be sent when bit 1 is set; the carrier (bit 2) is not looked at
mconst:	in	mstat
	ani	1
	rz
	mvi	a,0ffh
	ret
mconin:	in	mstat
	ani	1
	jz	mconin
	in	mdat
	ani	7fh
	ret
mconout:in	mstat
	ani	2
	jz	mconout
	mov	a,c
	out	mdat
	ret

;	printer: the printer, or the modem when the I/O byte says UL1:
list:	lda	iobyte
	ani	0c0h
	cpi	ulst
	jz	mconout
	in	prts		;wait while off line
	ora	a
	jz	list
	mov	a,c
	out	prtd
	ret

listst:	lda	iobyte
	ani	0c0h
	cpi	ulst
	jz	mlst
	in	prts
	ret

;	the modem may take a byte: 0FFh
mlst:	in	mstat
	ani	2
	rz
	mvi	a,0ffh
	ret

;	paper tape: the host's files, through the PAPER TAPE panel; the modem when the I/O byte says UP1: or UR1:
punch:	lda	iobyte
	ani	30h
	cpi	upun
	jz	mconout
	mov	a,c
	out	pund
	ret

reader:	lda	iobyte
	ani	0ch
	cpi	urdr
	jz	mconin
	in	rdrd		;1Ah when the tape has run out
	ret

;	disks
home:	mvi	c,0
settrk:	mov	a,c
	out	fdct
	ret

seldsk:	lxi	h,0		;HL = 0: no such drive
	mov	a,c
	cpi	8
	jz	seli
	cpi	4
	rnc
	out	fdcd
	in	fdcd		;a disk in it?
	ora	a
	rz
	mov	l,c		;HL = dpbase + 16 * drive
	dad	h
	dad	h
	dad	h
	dad	h
	lxi	d,dpbase
	dad	d
	in	fdcfmt		;which format is the disk?
	cpi	nfmts
	jnc	selno
	push	h		;the DPH
	add	a
	add	a		;4 bytes an entry
	mov	e,a
	mvi	d,0
	lxi	h,fmttab
	dad	d
	mov	e,m		;DE = its skew table
	inx	h
	mov	d,m
	inx	h
	mov	a,m		;HL = its DPB
	inx	h
	mov	h,m
	mov	l,a
	xthl			;HL = DPH, the DPB on the stack
	mov	m,e		;DPH+0: skew table
	inx	h
	mov	m,d
	lxi	d,9
	dad	d		;DPH+10: DPB
	pop	d
	mov	m,e
	inx	h
	mov	m,d
	lxi	d,-11
	dad	d		;back to the DPH
	ret
selno:	lxi	h,0		;a format this BIOS does not know
	ret
seli:	out	fdcd
	in	fdcd
	ora	a
	rz
	lxi	h,dphi
	ret

setsec:	mov	a,c
	out	fdcs
	mov	a,b
	out	fdcsh
	ret

setdma:	mov	a,c
	out	dmal
	mov	a,b
	out	dmah
	ret

read:	xra	a
	jmp	rwop
write:	mvi	a,1
rwop:	out	fdcop
	in	fdcst
	ora	a
	rz			;A = 0: done
	mvi	a,1		;A = 1: error
	ret

;	translate sector BC through the table at DE (none: just add 1)
sectran:
	mov	a,d
	ora	e
	jz	notran
	xchg
	dad	b
	mov	l,m
	mvi	h,0
	ret
notran:	mov	h,b
	mov	l,c
	inx	h
	ret

biosend	equ	$		;the loader reads up to ccp+1980h

;	scratch areas: not on the disk, the BDOS fills them
dirbuf:	ds	128
alv0:	ds	31
csv0:	ds	16
alv1:	ds	31
csv1:	ds	16
alv2:	ds	31
csv2:	ds	16
alv3:	ds	31
csv3:	ds	16
alvi:	ds	255
	end
