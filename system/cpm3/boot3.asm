;	DigitalRerun cold-start loader for CP/M 3
;
;	The boot ROM reads this sector (track 0, sector 1 of A:) into
;	0000h and starts the CPU there. It reads CPMLDR (CPMLDR.COM, which
;	tools/build-cpm3.js writes behind it, from sector 2 on) into 0100h
;	and starts it; CPMLDR then loads CPM3.SYS from the disk's files.
;	nsects is the size of CPMLDR.COM in records, given by the build.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.

ldr	equ	0100h		;where CPMLDR runs

;	disk controller ports (z80pack)
fdcd	equ	10		;drive
fdct	equ	11		;track
fdcs	equ	12		;sector, low byte
fdcsh	equ	17		;sector, high byte
fdcop	equ	13		;command: 0 read, 1 write
fdcst	equ	14		;status: 0 ok
dmal	equ	15		;DMA address, low byte
dmah	equ	16		;DMA address, high byte
fdcfmt	equ	18		;format of the disk: 0 is the 8" with 26 records a track
cond	equ	1		;console data

	org	0
	lxi	sp,100h
	xra	a
	out	fdcd		;drive A:
	out	fdcsh
	mov	e,a		;track 0
	in	fdcfmt
	mvi	d,27		;the 8" disk: sectors 1-26
	ora	a
	jz	go
	mvi	d,41		;the 5 1/4" disks: records 1-40
go:	lxi	h,ldr		;load address
	mvi	b,2		;first sector
	mvi	c,nsects	;sectors to read
loop:	mov	a,e
	out	fdct
	mov	a,b
	out	fdcs
	mov	a,l
	out	dmal
	mov	a,h
	out	dmah
	xra	a
	out	fdcop		;read
	in	fdcst
	ora	a
	jnz	fail
	push	d
	lxi	d,128
	dad	d		;next load address
	pop	d
	dcr	c
	jz	ldr		;all read: start CPMLDR
	inr	b
	mov	a,b
	cmp	d
	jc	loop
	mvi	b,1		;next track
	inr	e
	jmp	loop

fail:	lxi	h,msg
fail1:	mov	a,m
	ora	a
	jz	stop
	out	cond
	inx	h
	jmp	fail1
stop:	hlt

msg:	db	13,10,'BOOT ERROR',13,10,0
	end
