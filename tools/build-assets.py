# Builds the picture cards in assets/ from panel shots (see CLAUDE.md, "Bilder neu erzeugen").
# Usage: python3 tools/build-assets.py <work dir with panels/*.png>; writes <work dir>/out/*.png.
import subprocess,os,sys
S=os.path.abspath(sys.argv[1])
os.makedirs(S+'/cards',exist_ok=True);os.makedirs(S+'/out',exist_ok=True)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CSS="""
*{box-sizing:border-box;margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif;color:#f1f4ff;background:radial-gradient(1200px 800px at 80% 0%,#161c2b 0%,#0d111b 60%,#0a0d15 100%);overflow:hidden}
.eyebrow{color:#6fd39a;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
h1{font-weight:800;letter-spacing:-.02em;line-height:1.08;color:#f4f6ff}
p{color:#9aa3bd;line-height:1.5}
.frame{position:absolute;overflow:hidden;border:3px solid #3b4254;border-radius:30px;background:#171717;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.frame img{display:block;width:100%}
"""
def slide(name,w,h,eyebrow,title,sub,img,fx,fy,fw,fh,tx,ty,tw,fs,ps):
    html=f"""<!doctype html><meta charset=utf-8><style>{CSS}
body{{width:{w}px;height:{h}px;position:relative}}
.t{{position:absolute;left:{tx}px;top:{ty}px;width:{tw}px;transform:translateY(-50%)}}
.eyebrow{{font-size:{int(fs*.4)}px;margin-bottom:{int(fs*.3)}px}}
h1{{font-size:{fs}px}}
p{{font-size:{ps}px;margin-top:{int(fs*.35)}px}}
.frame{{left:{fx}px;top:{fy}px;width:{fw}px;height:{fh}px}}
</style><div class=t><div class=eyebrow>Skill Usage <span style="opacity:.8">×</span> Orca</div><h1>{title}</h1><p>{sub}</p></div>
<div class=frame><img src="file://{S}/panels/{img}.png"></div>"""
    f=f"{S}/cards/{name}.html";open(f,'w').write(html)
    subprocess.run([CHROME,"--headless=new","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=1",f"--window-size={w},{h}",f"--screenshot={S}/out/{name}.png","file://"+f],check=True,capture_output=True)
shots=[
 ("screenshot-overview","What is loaded,<br>what is used","Tokens per session and the entries nobody calls.","demo"),
 ("screenshot-skills","Where it exists,<br>where it is used","Per skill: calls, tokens per session and per call, and the folder to open.","details"),
 ("screenshot-project","One project,<br>one period","Find what a single project really needs.","project"),
 ("screenshot-mcp","MCP servers<br>per project","See which project needs which server.","mcp"),
 ("screenshot-unused","Find what costs<br>but never runs","Unused entries, sorted by token cost.","unused"),
 ("screenshot-gone","Know what<br>is gone","Entries that are no longer installed, or that Claude Code brings itself, are named and sorted last.","gone"),
]
for n,t,s,i in shots: slide(n,1280,800,"",t,s,i,730,38,460,724,70,400,560,52,24)
slide("cover",1600,1000,"","Skill<br>Usage","See what your AI really loads<br>and what it actually uses.","demo",1032,96,458,809,90,420,640,84,30)
# access card
acc="""<!doctype html><meta charset=utf-8><style>"""+CSS+"""
body{width:1280px;height:800px;padding:62px 80px}
.eyebrow{font-size:19px;margin-bottom:14px}h1{font-size:68px}p{font-size:23px;margin-top:14px}
.row{display:flex;gap:26px;align-items:center;background:#171c2a;border:1px solid #272e40;border-radius:16px;padding:16px 28px;margin-top:16px}
.ok{flex:none;width:46px;height:46px;border-radius:50%;background:#2c5a45;color:#8be3b4;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700}
.row b{display:block;font-size:30px;color:#f4f6ff}.row span{font-size:21px;color:#9aa3bd}
.foot{position:absolute;bottom:26px;left:80px;font-size:18px;color:#7d86a0}
</style><div class=eyebrow>Skill Usage <span style="opacity:.8">×</span> Orca</div><h1>Why “Full access”?</h1>
<p>Orca gives every plugin with a worker process this label.<br>Here is what Skill Usage actually does with it:</p><div style="margin-top:26px">
<div class=row><div class=ok>✓</div><div><b>Read-only</b><span>Reads your skill, agent and session files. Writes only its own counters to Orca’s plugin storage.</span></div></div>
<div class=row><div class=ok>✓</div><div><b>Names, not secrets</b><span>Only server names, tool names, timestamps and ids. No prompts, answers or secrets.</span></div></div>
<div class=row><div class=ok>✓</div><div><b>No network</b><span>Makes no network requests. Nothing leaves your machine, no tracking.</span></div></div>
<div class=row><div class=ok>✓</div><div><b>No changes</b><span>Never changes a file, types into a terminal or starts an agent. It opens a skill folder only on click.</span></div></div></div>
<div class=foot>Small open-source code, so you can read it before you approve. Updates with more access need a new approval.</div>"""
f=f"{S}/cards/screenshot-access.html";open(f,'w').write(acc)
subprocess.run([CHROME,"--headless=new","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=1","--window-size=1280,800",f"--screenshot={S}/out/screenshot-access.png","file://"+f],check=True,capture_output=True)
