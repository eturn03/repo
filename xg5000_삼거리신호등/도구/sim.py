# 래더 논리 검산: 스캔 단위로 TON 체인 + 단계 릴레이 + 램프 출력을 그대로 흉내 낸다 (Python)
# 타이머 단위 100ms. 1스캔 = 10ms 로 가정(결과는 스캔 시간에 거의 무관).
SCAN=0.01; BASE=0.1
PT={'T0':300,'T1':300,'T2':100,'T3':100,'T4':100}   # 30s,30s,10s,10s,10s
class TON:
    def __init__(s,pt): s.pt=pt; s.et=0.0; s.q=False
    def run(s,inp):
        if not inp: s.et=0.0; s.q=False
        else:
            if not s.q:
                s.et+=SCAN
                if s.et>=s.pt*BASE-1e-9: s.q=True
        return s.q
T={k:TON(v) for k,v in PT.items()}
q={k:False for k in PT}
log=[]; t=0.0; cycles=0
NS=int(300/SCAN)  # 300초 시뮬
for i in range(NS):
    # 타이머 체인 (프로그램 순서대로)
    q['T0']=T['T0'].run(not q['T4'])
    q['T1']=T['T1'].run(q['T0'])
    q['T2']=T['T2'].run(q['T1'])
    q['T3']=T['T3'].run(q['T2'])
    q['T4']=T['T4'].run(q['T3'])
    # 단계 릴레이
    M0 = not q['T0']
    M1 = q['T0'] and not q['T1']
    M2 = q['T1'] and not q['T2']
    M3 = q['T2'] and not q['T3']
    M4 = q['T3']
    # 램프
    out=dict(N_L=M0, N_G=M1, N_Y=M2, N_R=M3 or M4,
             S_G=M1, S_Y=M2, S_R=M0 or M3 or M4,
             W_L=M3, W_Y=M4, W_R=M0 or M1 or M2)
    log.append((round(t,2),out,(M0,M1,M2,M3,M4)))
    t+=SCAN
# 1) 각 스캔에서 단계가 정확히 하나만 켜지는지
bad=[l for l in log if sum(l[2])!=1]
print('단계 하나만 ON 위반 스캔 수:',len(bad), bad[:3])
# 2) 각 방향 램프가 정확히 하나만 켜지는지
for d in 'NSW':
    bad=[l for l in log if sum(v for k,v in l[1].items() if k.startswith(d))!=1]
    print(d,'방향 램프 하나만 ON 위반:',len(bad), bad[:2])
# 3) 충돌: 북 좌회전 중 남 초록 / 서 좌회전 중 북·남 빨강 아님
print('북좌회전&남초록 충돌:',sum(1 for l in log if l[1]['N_L'] and l[1]['S_G']))
print('서좌회전 중 북·남 빨강 아님:',sum(1 for l in log if l[1]['W_L'] and not (l[1]['N_R'] and l[1]['S_R'])))
print('북or남 초록/좌회전 중 서 빨강 아님:',sum(1 for l in log if (l[1]['N_L'] or l[1]['N_G'] or l[1]['S_G']) and not l[1]['W_R']))
# 4) 각 램프 ON 구간 길이 (첫 2 사이클)
def segs(key):
    res=[]; start=None
    for tt,o,_ in log:
        v=o[key]
        if v and start is None: start=tt
        if not v and start is not None: res.append((start,round(tt-start,2))); start=None
    return res
for k in ['N_L','N_G','N_Y','N_R','S_G','S_Y','S_R','W_L','W_Y','W_R']:
    print(k, segs(k)[:4])
