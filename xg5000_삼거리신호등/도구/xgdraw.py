# xgdraw.py — XG5000 실습 가이드용 그림 도구 (Python + Pillow)
from PIL import Image, ImageDraw, ImageFont
import math
FR='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'; FB='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
def F(s,b=False): return ImageFont.truetype(FB if b else FR,s)
RED=(220,30,30); BLUE=(70,100,200); LIVE=(225,35,35); DEAD=(30,30,30)
MON=(40,90,230); SLASH_ON=(240,220,0); GRAY=(95,95,95)

# ---------- 공통 레이아웃 ----------
def header(title,lines,width=1400,size=30):
    h=30+56+len(lines)*(size+16)+20; im=Image.new('RGB',(width,h),'white'); d=ImageDraw.Draw(im)
    d.rectangle([0,0,width,10],fill=RED); d.text((30,25),title,font=F(40,True),fill=(20,20,20))
    for i,l in enumerate(lines): d.text((40,90+i*(size+16)),l,font=F(size),fill=(40,40,40))
    return im
def cap(im,text,sub=None,size=30,subsize=26,w=None):
    W=w or im.width; h=size+30+((subsize+14) if sub else 0); c=Image.new('RGB',(W,h+im.height),'white'); d=ImageDraw.Draw(c)
    d.text((20,10),text,font=F(size,True),fill=(20,20,20))
    if sub: d.text((24,size+22),sub,font=F(subsize),fill=(90,90,90))
    c.paste(im,((W-im.width)//2,h)); ImageDraw.Draw(c).rectangle([0,h,c.width-1,c.height-1],outline=(200,200,200),width=2); return c
def stack(parts,path=None,pad=20,width=None):
    w=width or max(p.width for p in parts); h=sum(p.height for p in parts)+pad*(len(parts)+1)
    o=Image.new('RGB',(w,h),'white'); y=pad
    for p in parts: o.paste(p,((w-p.width)//2,y)); y+=p.height+pad
    if path: o.save(path)
    return o
def row(parts,gap=20,width=1400):          # 가로 배치 (2×2 패널용)
    h=max(p.height for p in parts); o=Image.new('RGB',(width,h),'white')
    tot=sum(p.width for p in parts)+gap*(len(parts)-1); x=(width-tot)//2
    for p in parts: o.paste(p,(x,0)); x+=p.width+gap
    return o
def pad_bottom(im,px):  # 라벨이 잘리지 않게 아래 여백 추가
    c=Image.new('RGB',(im.width,im.height+px),'white'); c.paste(im,(0,0)); return c
def scale(im,w): return im.resize((w,int(im.height*w/im.width)),Image.LANCZOS)
def label(d,xy,text,size=30,bg=RED):
    f=F(size,True); bb=d.textbbox(xy,text,font=f)
    d.rectangle([bb[0]-10,bb[1]-6,bb[2]+10,bb[3]+6],fill=bg); d.text(xy,text,font=f,fill='white')
def box(d,xyxy,color=RED,w=6): d.rectangle(xyxy,outline=color,width=w)
def arrow(d,p1,p2,w=6,color=RED):
    d.line([p1,p2],fill=color,width=w); a=math.atan2(p2[1]-p1[1],p2[0]-p1[0]); L=26
    d.polygon([p2,(p2[0]-L*math.cos(a-.45),p2[1]-L*math.sin(a-.45)),(p2[0]-L*math.cos(a+.45),p2[1]-L*math.sin(a+.45))],fill=color)
def gridify(path,out,step=100):  # 좌표 읽기용 격자. Read가 축소 표시하면 배율을 곱할 것
    im=Image.open(path).convert('RGB'); d=ImageDraw.Draw(im); f=F(18)
    for x in range(0,im.width,step): d.line([(x,0),(x,im.height)],fill=(0,200,255)); d.text((x+2,2),str(x),fill=(0,120,255),font=f)
    for y in range(0,im.height,step): d.line([(0,y),(im.width,y)],fill=(0,200,255)); d.text((2,y+2),str(y),fill=(0,120,255),font=f)
    im.save(out)

# ---------- XG5000 래더 화면 모형 ----------
CW=150; X0=150; XR=1250; RH=100; TOP=20   # 이름 표시(names)를 쓸 땐 xgdraw.RH=130으로 잠시 바꿔 겹침을 막는다
def cell_box(r,c): return (X0+c*CW+2, TOP+r*RH+4, X0+(c+1)*CW-2, TOP+(r+1)*RH-4)
def coil_box(r): cc=XR-CW//2; return (cc-CW//2+2, TOP+r*RH+4, cc+CW//2-2, TOP+(r+1)*RH-4)
def _contact(d,x0,ym,typ,dev,mon,fD):
    xc=x0+CW//2
    d.line([(x0,ym),(xc-16,ym)],fill='black',width=3); d.line([(xc+16,ym),(x0+CW,ym)],fill='black',width=3)
    d.line([(xc-16,ym-20),(xc-16,ym+20)],fill='black',width=3); d.line([(xc+16,ym-20),(xc+16,ym+20)],fill='black',width=3)
    val=None if mon is None else mon.get(dev,0)
    flow = val is not None and ((val==1) if typ=='c' else (val==0))   # a접점: 1일 때 / b접점: 0일 때 파랑 (매뉴얼 11-6·11-7)
    if flow: d.rectangle([xc-12,ym-14,xc+12,ym+14],fill=MON)
    if typ=='b': d.line([(xc-10,ym+15),(xc+10,ym-15)],fill=SLASH_ON if flow else 'black',width=4)
    tw=d.textlength(dev,font=fD); d.text((xc-tw/2,ym-58),dev,font=fD,fill=(220,0,0) if val==1 else 'black')
def ladder(rows,cursor=None,nrows=None,mon=None,names=None):
    """rows: [{'items':[(col,'c'|'b',dev),...], 'coil':dev, 'or_join':col, 'end':True}, ...]
       'c' = a접점(F3), 'b' = b접점(F4). OR 줄은 아랫줄 items + or_join(오른쪽 세로선 칸 경계).
       cursor=(row,col) 파란 커서, mon={dev:0/1} 모니터 표시(None이면 편집 화면), names={dev:이름} 디바이스/변수 보기"""
    n=nrows or len(rows); im=Image.new('RGB',(XR+40,TOP+n*RH+20),'white'); d=ImageDraw.Draw(im); fD=F(26)
    d.rectangle([0,TOP,X0-10,TOP+n*RH],fill=(225,225,228))
    for r in range(n+1):
        for x in range(X0,XR,12): d.line([(x,TOP+r*RH),(x+5,TOP+r*RH)],fill=(215,215,235))
    for c in range(1,8):
        for y in range(TOP,TOP+n*RH,12): d.line([(X0+c*CW,y),(X0+c*CW,y+5)],fill=(225,225,240))
    for r in range(n): d.text((12,TOP+r*RH+8),f'L{r}',font=F(22),fill=(80,80,80))
    d.line([(X0,TOP),(X0,TOP+n*RH)],fill='black',width=5); d.line([(XR,TOP),(XR,TOP+n*RH)],fill='black',width=5)
    for r,rw in enumerate(rows):
        ym=TOP+r*RH+62; last=X0
        for (c,typ,dev) in rw.get('items',[]):
            _contact(d,X0+c*CW,ym,typ,dev,mon,fD); last=max(last,X0+(c+1)*CW)
        if names:
            fN=F(22)
            for (c,typ,dev) in rw.get('items',[]):
                if dev in names:
                    xc=X0+c*CW+CW//2; t=names[dev]; tw=d.textlength(t,font=fN); d.text((xc-tw/2,ym+20),t,font=fN,fill=(20,60,220))
            if rw.get('coil') in names:
                cc=XR-CW//2; t=names[rw['coil']]; tw=d.textlength(t,font=fN); d.text((cc-tw/2,ym+22),t,font=fN,fill=(20,60,220))
        if rw.get('or_join') is not None:
            cx=X0+rw['or_join']*CW; d.line([(cx,ym),(cx,ym-RH)],fill='black',width=3)
        if rw.get('coil'):
            dev=rw['coil']; cc=XR-CW//2; R=24; on=mon is not None and mon.get(dev,0)==1
            d.line([(last,ym),(cc-R,ym)],fill='black',width=3)
            d.arc([cc-R,ym-R,cc+R,ym+R],125,235,fill='black',width=4); d.arc([cc-R,ym-R,cc+R,ym+R],-55,55,fill='black',width=4)  # ( )
            d.line([(cc+R,ym),(XR,ym)],fill='black',width=3)
            if on: d.ellipse([cc-12,ym-12,cc+12,ym+12],fill=MON)
            tw=d.textlength(dev,font=fD); d.text((cc-tw/2,ym-60),dev,font=fD,fill=(220,0,0) if on else 'black')
        if rw.get('end'):
            d.line([(X0,ym),(XR-CW,ym)],fill='black',width=3); d.rectangle([XR-CW+10,ym-24,XR-10,ym+24],outline='black',width=3,fill='white')
            d.text((XR-CW+45,ym-18),'END',font=fD,fill='black'); d.line([(XR-10,ym),(XR,ym)],fill='black',width=3)
    if cursor:
        r,c=cursor; x0=X0+c*CW; y0=TOP+r*RH; d.rectangle([x0+3,y0+6,x0+CW-3,y0+RH-6],outline=BLUE,width=6)
    return im

# ---------- 릴레이 회로도(L1-L2): 빨간 굵은 선 = 전류가 실제로 흐르는 길 ----------
def rcanvas(w,h,xl,xr):          # 전체 폭이면 1300·70·1230, 2×2 패널이면 680·50·640
    im=Image.new('RGB',(w,h),'white'); d=ImageDraw.Draw(im); f=F(30,True)
    d.text((xl-18,6),'L1',font=f,fill=DEAD); d.text((xr-18,6),'L2',font=f,fill=DEAD)
    d.line([(xl,50),(xl,h-20)],fill=DEAD,width=6); d.line([(xr,50),(xr,h-20)],fill=DEAD,width=6); return im,d
def wire(d,p1,p2,on): d.line([p1,p2],fill=LIVE if on else DEAD,width=7 if on else 4)
def draw_all(d,wires,syms):      # wires=[(p1,p2,on)], syms=[lambda: sw(...)]: 끊긴 선 먼저, 전류 선 나중, 기호는 맨 나중
    for p1,p2,on in sorted(wires,key=lambda w:w[2]): wire(d,p1,p2,on)
    for f in syms: f()
def sw(d,x,y,closed,lab,on,stem=True):
    """a접점. 누름버튼(stem=True, ㅗ 모양) / 릴레이 a접점(stem=False, ㅡ 모양). 단자 x, x+70. 막대가 단자 위."""
    c=LIVE if on else DEAD
    for tx in (x,x+70): d.ellipse([tx-8,y-8,tx+8,y+8],outline=c,width=4,fill='white')
    by=y-10 if closed else y-34; d.line([(x-8,by),(x+78,by)],fill=c,width=7)
    if stem: d.line([(x+35,by),(x+35,by-34)],fill=c,width=5); d.line([(x+20,by-34),(x+50,by-34)],fill=c,width=6)
    f=F(34,True); tw=d.textlength(lab,font=f); d.text((x+35-tw/2,by-(88 if stem else 56)),lab,font=f,fill=c)
def bsw(d,x,y,closed,lab,on,tag=True):
    """릴레이 b접점: 막대가 단자 '아래'. closed=True면 단자 밑에 붙어 있고, 코일이 켜지면 아래로 떨어진다. [보충 표기]"""
    c=LIVE if on else DEAD
    by=y+10 if closed else y+34; d.line([(x-8,by),(x+78,by)],fill=c,width=7)
    for tx in (x,x+70): d.ellipse([tx-8,y-8,tx+8,y+8],outline=c,width=4,fill='white')
    f=F(34,True); tw=d.textlength(lab,font=f); d.text((x+35-tw/2,y-62),lab,font=f,fill=c)
    if tag: d.text((x+35+tw/2+6,y-48),'b',font=F(20,True),fill=c)
def load(d,cx,y,lab,on,kind):  # kind: 'coil'(켜지면 파랑) / 'lamp'(켜지면 노랑)
    r=36; fill={'coil':(120,170,255),'lamp':(255,215,0)}[kind] if on else 'white'
    d.ellipse([cx-r,y-r,cx+r,y+r],outline=LIVE if on else DEAD,width=5,fill=fill)
    f=F(36,True); tw=d.textlength(lab,font=f); d.text((cx-tw/2,y-26),lab,font=f,fill=(20,20,20))
def series_row(d,y,switches,ld,on,xl=70,xr=1230):
    """switches: [(x, closed, label, stem)], ld: (label, kind, cx). on = 이 줄 전체가 통전되는지"""
    prev=xl
    for (x,cl,lab,stem) in switches: wire(d,(prev,y),(x-8,y),on); sw(d,x,y,cl,lab,on,stem); prev=x+78
    lab,kind,cx=ld; wire(d,(prev,y),(cx-36,y),on); load(d,cx,y,lab,on,kind); wire(d,(cx+36,y),(xr,y),on)
