# lad.py — XG5000(XGK) 래더 화면 모형 + 신호등 과제 전용 그림 도구 (Python + Pillow)
import sys, math
sys.path.insert(0, '/tmp/claude-0/-home-user-repo/28ee773a-20c3-57d7-aa22-22630aaaf2a4/scratchpad/work')
from xgdraw import F, RED, BLUE, MON, label, box, arrow, header, cap, stack, row, pad_bottom, scale
from PIL import Image, ImageDraw

CW=180; X0=140; NCOL=6; XR=X0+NCOL*CW; RH=118; TOP=16; CMH=46
NAMEC=(20,60,220); CMTC=(30,110,60)

def _txt_c(d, cx, y, t, f, fill):
    tw=d.textlength(t,font=f); d.text((cx-tw/2,y),t,font=f,fill=fill)

def _val(mon,dev):
    return None if mon is None else mon.get(dev,0)

def _contact(d,x0,ym,typ,dev,mon,names):
    xc=x0+CW//2; fD=F(26)
    d.line([(x0,ym),(xc-16,ym)],fill='black',width=3); d.line([(xc+16,ym),(x0+CW,ym)],fill='black',width=3)
    d.line([(xc-16,ym-20),(xc-16,ym+20)],fill='black',width=3); d.line([(xc+16,ym-20),(xc+16,ym+20)],fill='black',width=3)
    val=_val(mon,dev)
    flow = val is not None and ((val==1) if typ=='c' else (val==0))
    if flow: d.rectangle([xc-12,ym-14,xc+12,ym+14],fill=MON)
    if typ=='b': d.line([(xc-10,ym+15),(xc+10,ym-15)],fill=(240,220,0) if flow else 'black',width=4)
    _txt_c(d,xc,ym-56,dev,fD,(220,0,0) if val==1 else 'black')
    if names and dev in names: _txt_c(d,xc,ym+24,names[dev],F(20),NAMEC)

def _coil(d,last,ym,dev,mon,names):
    cc=XR-CW//2; R=24; on=_val(mon,dev)==1
    d.line([(last,ym),(cc-R,ym)],fill='black',width=3)
    d.arc([cc-R,ym-R,cc+R,ym+R],125,235,fill='black',width=4); d.arc([cc-R,ym-R,cc+R,ym+R],-55,55,fill='black',width=4)
    d.line([(cc+R,ym),(XR,ym)],fill='black',width=3)
    if on: d.ellipse([cc-12,ym-12,cc+12,ym+12],fill=MON)
    _txt_c(d,cc,ym-58,dev,F(26),(220,0,0) if on else 'black')
    if names and dev in names: _txt_c(d,cc,ym+26,names[dev],F(20),NAMEC)

def _inst(d,last,ym,text,mon,names):
    bx0=XR-2*CW+10; bx1=XR-12
    d.line([(last,ym),(bx0,ym)],fill='black',width=3); d.line([(bx1,ym),(XR,ym)],fill='black',width=3)
    d.rectangle([bx0,ym-24,bx1,ym+24],outline='black',width=3,fill='white')
    parts=text.split(); tdev=parts[1] if len(parts)>1 else None
    on = tdev is not None and _val(mon,tdev)==1
    # 세 칸으로 나눠 배치: 명령 / 디바이스 / 설정값
    f=F(26); w=bx1-bx0
    if len(parts)==3:
        _txt_c(d,bx0+w*0.18,ym-16,parts[0],f,'black')
        _txt_c(d,bx0+w*0.50,ym-16,parts[1],f,(220,0,0) if on else 'black')
        _txt_c(d,bx0+w*0.82,ym-16,parts[2],f,(200,0,160))
        if names and tdev in names: _txt_c(d,bx0+w*0.50,ym+28,names[tdev],F(20),NAMEC)
        if mon is not None and (tdev+'_cv') in mon:
            _txt_c(d,bx0+w*0.82,ym+28,f'현재값 {mon[tdev+"_cv"]}',F(19),(200,0,160))
    else:
        _txt_c(d,(bx0+bx1)/2,ym-16,text,f,'black')

def ladder(rows,cursor=None,mon=None,names=None,hl=None,title=None):
    """rows: [{'items':[(col,'c'|'b',dev)...], 'coil':dev | 'inst':'TON T0000 300' | 'end':True, 'or_join':col}, {'comment':str}, ...]
       cursor=(line,col) 파란 커서(line = L번호), mon={dev:0/1, 'T0000_cv':123}, names={dev:이름}, hl=[(line,col)] 빨간 강조"""
    ys=[]; y=TOP
    for rw in rows:
        h=CMH if 'comment' in rw else RH; ys.append((y,h)); y+=h
    H=y+16; W=XR+40
    im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    d.rectangle([0,TOP,X0-10,y],fill=(225,225,228))
    for (y0,h) in ys:
        for x in range(X0,XR,12): d.line([(x,y0),(x+5,y0)],fill=(215,215,235))
    for c in range(1,NCOL):
        for yy in range(TOP,y,12): d.line([(X0+c*CW,yy),(X0+c*CW,yy+5)],fill=(228,228,242))
    d.line([(X0,TOP),(X0,y)],fill='black',width=5); d.line([(XR,TOP),(XR,y)],fill='black',width=5)
    ln=0; line_y={}; prev_rung_y=None
    for rw,(y0,h) in zip(rows,ys):
        if 'comment' in rw:
            d.text((X0+14,y0+9),rw['comment'],font=F(23),fill=CMTC); continue
        ym=y0+64; line_y[ln]=y0
        d.text((10,y0+8),f'L{ln}',font=F(22),fill=(80,80,80)); ln+=1
        last=X0
        for (c,typ,dev) in rw.get('items',[]):
            _contact(d,X0+c*CW,ym,typ,dev,mon,names); last=max(last,X0+(c+1)*CW)
        if rw.get('or_join') is not None and prev_rung_y is not None:
            cx=X0+rw['or_join']*CW; d.line([(cx,ym),(cx,prev_rung_y+64)],fill='black',width=3)
        if rw.get('coil'): _coil(d,last,ym,rw['coil'],mon,names)
        if rw.get('inst'): _inst(d,last,ym,rw['inst'],mon,names)
        if rw.get('end'):
            d.line([(X0,ym),(XR-CW,ym)],fill='black',width=3); d.rectangle([XR-CW+10,ym-24,XR-10,ym+24],outline='black',width=3,fill='white')
            _txt_c(d,XR-CW//2,ym-18,'END',F(26),'black'); d.line([(XR-10,ym),(XR,ym)],fill='black',width=3)
        prev_rung_y=y0
    if hl:
        for (l,c) in hl:
            y0=line_y[l]; x0=X0+c*CW
            if c>=NCOL-2 and c!=NCOL-1: d.rectangle([x0+3,y0+6,XR-3,y0+RH-6],outline=RED,width=6)
            else: d.rectangle([x0+3,y0+6,x0+CW-3,y0+RH-6],outline=RED,width=6)
    if cursor:
        l,c=cursor; y0=line_y.get(l, TOP+len(rows)*0)  # 빈 줄 커서
        if l not in line_y: y0=ys[-1][0]+ys[-1][1]-RH if False else y
        x0=X0+c*CW; d.rectangle([x0+3,y0+6,x0+CW-3,y0+RH-6],outline=BLUE,width=6)
    return im

def ladder_with_blank(rows,cursor_line,cursor_col):
    """마지막에 빈 줄을 하나 붙이고 그 줄에 커서를 둔다"""
    rows2=rows+[{'items':[]}]
    return ladder(rows2,cursor=(cursor_line,cursor_col))

# ---------- 프로그램 정의 ----------
NAMES={'T0000':'단계1끝','T0001':'단계2끝','T0002':'단계3끝','T0003':'단계4끝','T0004':'단계5끝',
 'M00000':'단계1_북좌','M00001':'단계2_직진','M00002':'단계3_주황','M00003':'단계4_서좌','M00004':'단계5_서주황',
 'P00020':'북_좌회전','P00021':'북_초록','P00022':'북_주황','P00023':'북_빨강',
 'P00024':'남_초록','P00025':'남_주황','P00026':'남_빨강',
 'P00027':'서_좌회전','P00028':'서_주황','P00029':'서_빨강'}

SEC_A=[{'comment':'■ A. 타이머 체인: 앞 타이머가 끝나면 다음 타이머 시작 (100ms 타이머, 300 = 30초)'},{'comment':'   마지막 단계5끝(T0004)이 켜지면 L0의 b접점이 열려 전부 리셋 → 다시 단계1부터'},
 {'items':[(0,'b','T0004')],'inst':'TON T0000 300'},
 {'items':[(0,'c','T0000')],'inst':'TON T0001 300'},
 {'items':[(0,'c','T0001')],'inst':'TON T0002 100'},
 {'items':[(0,'c','T0002')],'inst':'TON T0003 100'},
 {'items':[(0,'c','T0003')],'inst':'TON T0004 100'}]
SEC_B=[{'comment':'■ B. 단계 릴레이(M): "앞 단계 타이머는 끝났고(a접점) + 이 단계 타이머는 아직(b접점)" = 지금 이 단계'},
 {'items':[(0,'b','T0000')],'coil':'M00000'},
 {'items':[(0,'c','T0000'),(1,'b','T0001')],'coil':'M00001'},
 {'items':[(0,'c','T0001'),(1,'b','T0002')],'coil':'M00002'},
 {'items':[(0,'c','T0002'),(1,'b','T0003')],'coil':'M00003'},
 {'items':[(0,'c','T0003')],'coil':'M00004'}]
SEC_C=[{'comment':'■ C. 램프 출력(P): 램프마다 "어느 단계에 켜지나"를 접점으로 나열. 여러 단계면 병렬(OR)'},
 {'comment':'  북쪽 신호등 (좌회전 → 초록 → 주황 → 빨강)'},
 {'items':[(0,'c','M00000')],'coil':'P00020'},
 {'items':[(0,'c','M00001')],'coil':'P00021'},
 {'items':[(0,'c','M00002')],'coil':'P00022'},
 {'items':[(0,'c','M00003')],'coil':'P00023'},
 {'items':[(0,'c','M00004')],'or_join':1},
 {'comment':'  남쪽 신호등 (초록 → 주황 → 빨강 50초)'},
 {'items':[(0,'c','M00001')],'coil':'P00024'},
 {'items':[(0,'c','M00002')],'coil':'P00025'},
 {'items':[(0,'c','M00000')],'coil':'P00026'},
 {'items':[(0,'c','M00003')],'or_join':1},
 {'items':[(0,'c','M00004')],'or_join':1},
 {'comment':'  서쪽(왼쪽) 신호등 (좌회전 → 주황 → 빨강 70초)'},
 {'items':[(0,'c','M00003')],'coil':'P00027'},
 {'items':[(0,'c','M00004')],'coil':'P00028'},
 {'items':[(0,'c','M00000')],'coil':'P00029'},
 {'items':[(0,'c','M00001')],'or_join':1},
 {'items':[(0,'c','M00002')],'or_join':1}]
SEC_END=[{'end':True}]
PROGRAM=SEC_A+SEC_B+SEC_C+SEC_END

def renumber(rows):
    """설명문 줄을 뺀 L번호를 매겨 (list of (L, row)) 반환"""
    out=[]; n=0
    for r in rows:
        if 'comment' in r: continue
        out.append((n,r)); n+=1
    return out

# ---------- 시각 t초에서의 상태 ----------
def state(t):
    t=t%90.0
    q={'T0000':t>=30,'T0001':t>=60,'T0002':t>=70,'T0003':t>=80,'T0004':False}
    M=[not q['T0000'], q['T0000'] and not q['T0001'], q['T0001'] and not q['T0002'], q['T0002'] and not q['T0003'], q['T0003']]
    mon={k:int(v) for k,v in q.items()}
    for i,m in enumerate(M): mon[f'M0000{i}']=int(m)
    P={'P00020':M[0],'P00021':M[1],'P00022':M[2],'P00023':M[3] or M[4],
       'P00024':M[1],'P00025':M[2],'P00026':M[0] or M[3] or M[4],
       'P00027':M[3],'P00028':M[4],'P00029':M[0] or M[1] or M[2]}
    for k,v in P.items(): mon[k]=int(v)
    # 타이머 현재값(0.1초 단위)
    starts={'T0000':0,'T0001':30,'T0002':60,'T0003':70,'T0004':80}; pts={'T0000':300,'T0001':300,'T0002':100,'T0003':100,'T0004':100}
    for k,s in starts.items():
        cv=int(max(0,(t-s))*10); mon[k+'_cv']=min(cv,pts[k])
    return mon

# ---------- 삼거리 그림 ----------
LAMP={'G':(40,200,80),'Y':(255,190,0),'R':(235,40,40),'L':(40,200,80)}
def junction(phase, size=620, title=None):
    """phase 1~5. 북쪽 신호등=북쪽에 설치, 남→북 차량이 봄. 남쪽 신호등=남쪽에 설치, 북→남 차량이 봄. 서쪽=서쪽 가지에서 나오는 차량이 봄."""
    im=Image.new('RGB',(size,size),'white'); d=ImageDraw.Draw(im); c=size//2
    road=(120,120,120); RW=150
    d.rectangle([c-RW//2,0,c+RW//2,size],fill=road)           # 남북 도로
    d.rectangle([0,c-RW//2,c,c+RW//2],fill=road)                # 서쪽 가지
    # 차선(중앙선 노랑, 차로 점선 흰색)
    for y in range(0,size,40):
        if not (c-RW//2-5<y<c+RW//2+5): d.line([(c,y),(c,y+20)],fill=(250,210,0),width=4)
    for x in range(0,c-RW//2,40): d.line([(x,c),(x+20,c)],fill=(250,210,0),width=4)
    for y in range(0,size,40):
        if not (c-RW//2-5<y<c+RW//2+5):
            d.line([(c-RW//4,y),(c-RW//4,y+14)],fill='white',width=2); d.line([(c+RW//4,y),(c+RW//4,y+14)],fill='white',width=2)
    for x in range(0,c-RW//2,40):
        d.line([(x,c-RW//4),(x+14,c-RW//4)],fill='white',width=2); d.line([(x,c+RW//4),(x+14,c+RW//4)],fill='white',width=2)
    # 단계별 점등
    N={'L':phase==1,'G':phase==2,'Y':phase==3,'R':phase in(4,5)}
    S={'G':phase==2,'Y':phase==3,'R':phase in(1,4,5)}
    W={'L':phase==4,'Y':phase==5,'R':phase in(1,2,3)}
    def head(x,y,lamps,on,lab,horiz=True):
        n=len(lamps); w=44*n+12 if horiz else 56; h=56 if horiz else 44*n+12
        d.rounded_rectangle([x,y,x+w,y+h],radius=10,fill=(30,30,30))
        for i,k in enumerate(lamps):
            cx=x+6+22+44*i if horiz else x+28; cy=y+28 if horiz else y+6+22+44*i
            col=LAMP[k] if on[k] else (70,70,70)
            d.ellipse([cx-18,cy-18,cx+18,cy+18],fill=col)
            if k=='L':
                ac=(20,20,20) if on[k] else (110,110,110)
                d.line([(cx+10,cy),(cx-9,cy)],fill=ac,width=4); d.polygon([(cx-14,cy),(cx-5,cy-7),(cx-5,cy+7)],fill=ac)
        f=F(22,True); tw=d.textlength(lab,font=f)
        d.rectangle([x,y-30,x+tw+12,y-4],fill='white'); d.text((x+6,y-30),lab,font=f,fill=(20,20,20))
    head(c+RW//2+16, 60, ['L','G','Y','R'], N, '북쪽 신호등')
    head(c-RW//2-16-44*3-12, size-60-56, ['G','Y','R'], S, '남쪽 신호등')
    head(60, c-RW//2-16-56, ['L','Y','R'], W, '서쪽(왼쪽) 신호등')
    # 통행 화살표 (초록 = 지금 갈 수 있는 흐름)
    AC=(40,200,80)
    def arr(p1,p2,col=AC,w=8): arrow(d,p1,p2,w=w,color=col)
    def bend(pts,col=AC,w=8):
        d.line(pts[:-1],fill=col,width=w); arrow(d,pts[-2],pts[-1],w=w,color=col)
    nb_x=c+RW//4   # 남→북 차로(동쪽 절반)
    sb_x=c-RW//4   # 북→남 차로(서쪽 절반)
    if phase==1:   # 북행 좌회전
        bend([(nb_x,size-40),(nb_x,c+10),(nb_x-40,c-30),(60,c-30)])
    if phase==2:   # 북행 직진 + 남행 직진
        arr((nb_x,size-40),(nb_x,40)); arr((sb_x,40),(sb_x,size-40))
    if phase==4:   # 서쪽 가지 좌회전(동→북)
        bend([(40,c+RW//4),(c-RW//2-10,c+RW//4),(c+RW//4-30,c+RW//4-40),(nb_x,40)])
    # 남행 우회전(항상 가능, 신호 없음) 회색 점선 표기는 생략
    # 범례
    if title:
        return cap(im,title)
    return im

# ---------- 타임 차트 ----------
def timechart(width=1400):
    lamps=[('북_좌회전','P00020',[(0,30,'L')]),('북_초록','P00021',[(30,60,'G')]),('북_주황','P00022',[(60,70,'Y')]),('북_빨강','P00023',[(70,90,'R')]),
           ('남_초록','P00024',[(30,60,'G')]),('남_주황','P00025',[(60,70,'Y')]),('남_빨강','P00026',[(0,30,'R'),(70,90,'R')]),
           ('서_좌회전','P00027',[(70,80,'L')]),('서_주황','P00028',[(80,90,'Y')]),('서_빨강','P00029',[(0,70,'R')])]
    L=330; R=width-40; rh=46; top=120; H=top+rh*len(lamps)+70
    im=Image.new('RGB',(width,H),'white'); d=ImageDraw.Draw(im)
    def X(t): return L+(R-L)*t/90
    # 단계 머리
    steps=[(0,30,'단계1\n북 좌회전'),(30,60,'단계2\n직진(북·남 초록)'),(60,70,'단계3\n주황'),(70,80,'단계4\n서 좌회전'),(80,90,'단계5\n서 주황')]
    for i,(a,b,lab) in enumerate(steps):
        col=[(235,240,255),(240,255,240),(255,250,225),(240,255,240),(255,250,225)][i]
        d.rectangle([X(a),top-8,X(b),H-60],fill=col)
        f=F(20,True); 
        for j,line in enumerate(lab.split('\n')):
            tw=d.textlength(line,font=f); d.text(((X(a)+X(b))/2-tw/2,20+j*26),line,font=f,fill=(40,40,40))
        d.text((X(a)+4,top-34),f'{b-a}초',font=F(19),fill=(120,0,0))
    grp={'북':(0,4),'남':(4,7),'서':(7,10)}
    for i,(name,dev,segs) in enumerate(lamps):
        y=top+i*rh
        d.text((20,y+10),name,font=F(24,True),fill=(20,20,20)); d.text((170,y+13),dev,font=F(20),fill=(90,90,90))
        d.line([(L,y+rh-1),(R,y+rh-1)],fill=(220,220,220))
        for a,b,k in segs:
            d.rounded_rectangle([X(a)+2,y+6,X(b)-2,y+rh-8],radius=6,fill=LAMP[k])
            if k=='L':
                cx=(X(a)+X(b))/2; cy=y+rh/2-1; d.line([(cx+14,cy),(cx-12,cy)],fill='black',width=4); d.polygon([(cx-18,cy),(cx-8,cy-8),(cx-8,cy+8)],fill='black')
    for g,(a,b) in grp.items():
        d.line([(L-10,top+a*rh),(L-10,top+b*rh)],fill=(150,150,150),width=3)
    for t in [0,30,60,70,80,90]:
        d.line([(X(t),top-8),(X(t),H-60)],fill=(90,90,90),width=2)
        f=F(22,True); tw=d.textlength(f'{t}',font=f); d.text((X(t)-tw/2,H-52),f'{t}',font=f,fill=(30,30,30))
    d.text((R-120,H-28),'시간(초) →',font=F(20),fill=(60,60,60))
    d.text((L,H-28),'한 사이클 = 90초, 끝나면 단계1로 되돌아감',font=F(20),fill=(60,60,60))
    return im
