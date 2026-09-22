"""
最小可运行示例：用 navis 加载真实的示例果蝇神经元，
查看数据结构、突触连接器、做网络分析、导出可视化。
完全离线、零鉴权、零额外重型依赖（仅 matplotlib + scipy）。
"""
import matplotlib
matplotlib.use("Agg")  # 无显示器环境，图片存盘即可
matplotlib.rcParams['font.sans-serif'] = ['Hiragino Sans GB', 'Arial Unicode MS', 'STHeiti', 'DejaVu Sans']
matplotlib.rcParams['axes.unicode_minus'] = False
import matplotlib.pyplot as plt
from matplotlib import cm
import navis
import networkx as nx
import numpy as np
import pandas as pd

print("=" * 64)
print("navis 版本:", navis.__version__)
print("=" * 64)

# ---------- 1) 加载示例神经元（真实 FAFB 果蝇神经元） ----------
nl = navis.example_neurons(6)
print(f"\n[1] 加载了 {len(nl)} 条示例果蝇神经元 (NeuronList):")
for i, n in enumerate(nl):
    pre = int((n.connectors['type'] == 'pre').sum())
    post = int((n.connectors['type'] == 'post').sum())
    print(f"    #{i} {n.name:<11} id={n.id}  骨架节点={len(n.nodes):>5}  "
          f"突触连接器={n.n_connectors:>5} (pre={pre}, post={post})  "
          f"缆长={n.cable_length/1000:.0f} µm")

n = nl[0]
print(f"\n[2] 单条神经元 '{n.name}' 的完整属性:")
print(n)

# ---------- 2) 突触连接器表 = 连接信息的核心格式 ----------
print("\n[3] 突触连接器表 (connectors) 前 5 行:")
print("    connector_id=连接器编号 | node_id=所在骨架节点 | type=pre(前)/post(后)")
print("    x/y/z=三维坐标(nm) | roi=所在脑区 | confidence=置信度")
print(n.connectors.head().to_string(index=False))

# ---------- 3) 脑区(ROI)的输入/输出分布 ----------
piv = (n.connectors.groupby(['roi', 'type']).size()
       .unstack(fill_value=0).rename(columns={'post': '输入(post)', 'pre': '输出(pre)'}))
print(f"\n[4] '{n.name}' 各脑区的突触输入/输出分布:")
print(piv.to_string())
print("    解读: 在 AL(R)(触角叶) 以 post 为主=主要接收嗅觉输入;")
print("          在 LH(R)(侧角) 以 pre 为主=主要向下游输出。")

# ---------- 4) 单神经元骨架拓扑网络 ----------
G = n.graph
deg = dict(G.degree())
hubs = sorted(deg, key=deg.get, reverse=True)[:5]
print(f"\n[5] 单神经元骨架网络 (NetworkX):")
print(f"    节点数={G.number_of_nodes()}  边数={G.number_of_edges()}")
print(f"    分支度最高的枢纽骨架节点 Top5={hubs}")

# ---------- 5) 可视化A：ROI 输入/输出突触网络 ----------
Gnet = nx.Graph()
for roi, row in piv.iterrows():
    Gnet.add_node(roi, kind='roi')
    if row.get('输入(post)', 0) > 0:
        Gnet.add_edge('IN(接收)', roi, weight=row['输入(post)'], kind='in')
    if row.get('输出(pre)', 0) > 0:
        Gnet.add_edge(roi, 'OUT(发送)', weight=row['输出(pre)'], kind='out')
fig, ax = plt.subplots(figsize=(8, 6))
pos = nx.spring_layout(Gnet, seed=7)
for kind, color in [('in', '#3fb950'), ('out', '#f85149')]:
    es = [(u, v) for u, v, d in Gnet.edges(data=True) if d['kind'] == kind]
    ws = [Gnet[u][v]['weight'] for u, v in es]
    ws = [max(0.5, w / max(ws) * 6) for w in ws] if ws else ws
    nx.draw_networkx_edges(Gnet, pos, edgelist=es, width=ws,
                           edge_color=color, alpha=0.7, ax=ax)
nx.draw_networkx_nodes(Gnet, pos, nodelist=[x for x in Gnet if x not in ('IN(接收)', 'OUT(发送)')],
                       node_color='#4C8BF5', node_size=1500, ax=ax)
nx.draw_networkx_nodes(Gnet, pos, nodelist=['IN(接收)', 'OUT(发送)'],
                       node_color='#dddddd', node_size=2200, node_shape='s', ax=ax)
nx.draw_networkx_labels(Gnet, pos, font_size=8, ax=ax)
ax.set_title(f"{n.name}  突触分布网络  (绿=输入 / 红=输出)")
fig.savefig("roi_synapse_network.png", dpi=130, bbox_inches='tight')
print("\n[6] 已导出: roi_synapse_network.png")

# ---------- 6) 可视化B：真 3D 渲染（matplotlib mplot3d，自绘） ----------
from mpl_toolkits.mplot3d.art3d import Line3DCollection
fig3 = plt.figure(figsize=(9, 7))
ax3 = fig3.add_subplot(111, projection='3d')
colors = cm.tab10(np.linspace(0, 1, len(nl)))
for i, nn in enumerate(nl):
    nodes = nn.nodes.set_index('node_id')
    xyz = nodes[['x', 'y', 'z']].to_numpy(dtype=float)
    parents = nodes['parent_id'].to_numpy()
    idx_map = {nid: k for k, nid in enumerate(nodes.index)}
    segs = []
    for k, p in enumerate(parents):
        if p in idx_map and p != -1:
            segs.append([xyz[k], xyz[idx_map[p]]])
    if segs:
        ax3.add_collection3d(Line3DCollection(
            np.array(segs), colors=colors[i], linewidths=0.4, alpha=0.8))
ax3.set_facecolor('black'); fig3.patch.set_facecolor('black')
ax3.set_title("果蝇神经元 3D 骨架 (navis)", color='white')
ax3.set_xlabel('X (nm)', color='white'); ax3.set_ylabel('Y (nm)', color='white')
ax3.tick_params(colors='white')
allx = np.concatenate([nn.nodes['x'].to_numpy() for nn in nl])
ally = np.concatenate([nn.nodes['y'].to_numpy() for nn in nl])
allz = np.concatenate([nn.nodes['z'].to_numpy() for nn in nl])
ax3.set_xlim(allx.min(), allx.max()); ax3.set_ylim(ally.min(), ally.max())
ax3.set_zlim(allz.min(), allz.max())
fig3.savefig("neurons_3d.png", dpi=110, facecolor='black', bbox_inches='tight')
print("[7] 已导出: neurons_3d.png")

# ---------- 7) 可视化C：navis 自带 2D 投影 ----------
fig2, ax2 = navis.plot2d(n, method='2d')
fig2.savefig("neuron_2d_projection.png", dpi=130, bbox_inches='tight')
print("[8] 已导出: neuron_2d_projection.png")

print("\n" + "=" * 64)
print("完成。连接组数据的基本形态：")
print("  单条神经元 = 骨架节点(nodes) + 突触连接器(connectors: pre/post + 脑区)")
print("  连接组     = 神经元之间 谁连谁、连了几个突触 的有向加权图")
print("=" * 64)
