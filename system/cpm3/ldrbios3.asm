;	DigitalRerun loader BIOS for CP/M 3
;
;	The small BIOS CPMLDR uses to find CPM3.SYS on A: and read it:
;	console output and the disk controller (the ports of bios3.asm).
;	Assembled with RMAC and linked behind CPMLDR (LINK CPMLDR=CPMLDR,SCB,LDRBIOS3): CPMLDR calls
;	the jump table at the next page boundary after itself.
;
;	Copyright (c) 2026 Costin Stroie, MIT licence.


cond	equ	1		;console data
fdcd	equ	10		;drive; IN: 0FFh when it holds a disk
fdct	equ	11		;track
fdcs	equ	12		;sector, low byte
fdcsh	equ	17		;sector, high byte
fdcop	equ	13		;command: 0 read, 1 write
fdcst	equ	14		;status: 0 ok
dmal	equ	15		;DMA address, low byte
dmah	equ	16		;DMA address, high byte
fdcfmt	equ	18		;IN: format of the selected drive's disk

	cseg

	jmp boot	; cold start
	jmp wboot
	jmp const
	jmp conin
	jmp conout	; console output
	jmp list
	jmp auxout
	jmp auxin
	jmp home	; home
	jmp seldsk	; select disk
	jmp settrk	; set track
	jmp setsec	; set sector
	jmp setdma	; set DMA
	jmp read	; read
	jmp write
	jmp listst
	jmp sectrn	; sector translate
	jmp conost
	jmp auxist
	jmp auxost
	jmp devtbl
	jmp devini
	jmp drvtbl
	jmp multio
	jmp flush
	jmp move	; memory move
	jmp time
	jmp selmem
	jmp setbnk
	jmp xmove
	jmp 0
	jmp 0
	jmp 0

boot:
wboot:
const:
conin:
list:
auxout:
auxin:
write:
listst:
conost:
auxist:
auxost:
devtbl:
devini:
drvtbl:
multio:
flush:
time:
selmem:
setbnk:
xmove:	ret

conout:	mov a,c
	out cond
	ret

;	only A: is known to the loader
seldsk:	mov a,c
	ora a
	jnz selno
	out fdcd
	in fdcd	;a disk in it?
	ora a
	jz selno
	in fdcfmt
	cpi nfmts
	jnc selno
	add a
	add a
	mov l,a
	mvi h,0
	lxi b,fmttab
	dad b
	mov c,m
	inx h
	mov b,m	;BC = skew table
	inx h
	mov e,m
	inx h
	mov d,m	;DE = DPB
	lxi h,dph0
	mov m,c
	inx h
	mov m,b
	lxi h,dph0+12
	mov m,e
	inx h
	mov m,d
	lxi h,dph0
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
	out fdcop
	in fdcst
	ora a
	rz
	mvi a,1
	ret

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

dph0:	dw	trans
	db	0,0,0,0,0,0,0,0,0,0
	dw	dpb8,csv,alv,0fffeh,0ffffh,0ffffh
	db	0
csv:	ds	16
alv:	ds	32

dpb8:	dw	26
	db	3,7,0
	dw	242,63
	db	0c0h,0
	dw	16,2
	db	0,0
dpbs5:	dw	40
	db	3,7,0
	dw	194,63
	db	0c0h,0
	dw	16,1
	db	0,0
dpbd5:	dw	40
	db	4,15,1
	dw	196,63
	db	080h,0
	dw	16,1
	db	0,0
dpbk5:	dw	40
	db	3,7,0
	dw	184,63
	db	0c0h,0
	dw	16,3
	db	0,0

fmttab:	dw	trans,dpb8
	dw	0,dpbs5
	dw	0,dpbd5
	dw	0,dpbk5
nfmts	equ	4

trans:	db	1,7,13,19,25,5,11,17,23,3,9,15,21
	db	2,8,14,20,26,6,12,18,24,4,10,16,22

	end
