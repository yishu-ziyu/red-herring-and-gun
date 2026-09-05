from pathlib import Path
import os,re,json,collections
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
skip={'.git','node_modules','vendor','dist','dist-a','dist-b','.venv','.cache','FrontierAgent','AgentHarness','design-overview','exports','outputs','.ship'}
items=[]; allowed=set()
image_ext={'.png','.jpg','.jpeg','.svg','.webp','.gif'}
labels={
'mvp/DESIGN.md':'当前产品的设计规范','mvp/DESIGN-GALLERY.md':'按产品场景整理的动效与零件索引',
'packages/web/output/show-me-parts/index.html':'既有零件展示：要 / 不要',
'packages/web/output/show-me-walk/index.html':'既有用户路径走查：桌面与手机',
}
def add(p,kind,group,note='',featured=False):
 s=p.as_posix(); allowed.add(s)
 title=labels.get(s,p.stem)
 if kind=='html' and s not in labels:
  m=re.search(r'<title>(.*?)</title>',(ROOT/p).read_text(errors='replace'),re.S)
  if m:title=m.group(1).strip()
 if '/01-result/screens/' in s:
  title={'index.html':'今天的修正版：沿用现有产品界面','first-reading-layout.html':'今天的首版：用户指出偏离既有设计','mobile.html':'今天的修正版：390px 窄屏'}.get(p.name,title)
 items.append(dict(title=title,path=s,kind=kind,group=group,note=note,featured=featured))
for r,ds,fs in os.walk(ROOT):
 ds[:]=[d for d in ds if d not in skip]
 for name in sorted(fs):
  p=(Path(r)/name).relative_to(ROOT); s=p.as_posix(); ext=p.suffix.lower()
  if ext in image_ext:
   group='历史截图'
   if '/frames/' in s:group='参考视频逐帧'
   elif name.startswith('ref-') or '/show-me-parts/' in s or '/apodex-replica/' in s:group='外部设计参考'
   elif s.startswith(('exports/','outputs/')):group='演示与路演'
   elif '/public/' in s or name=='logo.png':group='品牌与图标'
   add(p,'image',group,'文件夹现存原图；不代表当前线上状态')
  elif ext=='.html' and s not in {'mvp/index.html','packages/web/index.html'} and 'fetch/__fixtures__' not in s:
   group='历史 HTML 与对照';note='保留原稿；其中的方向与文案可能已过时'
   if '/01-result/screens/' in s:group='本轮待评原型';note='静态示例数据；首版已不作为实施依据，修正版待用户认可'
   elif 'apodex-replica' in s:group='外部设计参考';note='项目内保存的复刻参考；不是本产品'
   add(p,'html',group,note,'/show-me-' in s or s.endswith('/screens/index.html'))
  elif ext in {'.tsx','.css'} and s.startswith(('mvp/src/','packages/web/src/')) and not re.search(r'\.(test|spec)\.',name):
   add(p,'text','界面源码','源文件目录；文件存在不等于该组件当前挂载')
  elif ext=='.md' and (s in {'mvp/DESIGN.md','mvp/DESIGN-GALLERY.md','docs/PRODUCT_SPEC.md','docs/ARCHITECTURE.md','docs/evals/2026-09-05-investigation-continuity.md','docs/evals/2026-09-05-investigation-result-prototype.md','docs/devlog/2026-09-05-result-prototype-first.md'}):
   add(p,'text','设计说明与存档','历史存档不自动成为当前产品约定',s in {'mvp/DESIGN.md','mvp/DESIGN-GALLERY.md'})
  elif ext in {'.excalidraw','.pptx','.pdf','.fig'}:
   add(p,'download','演示与路演' if s.startswith(('exports/','outputs/')) else '设计说明与存档','可下载原始文件')
# Preserve relative HTML assets. No arbitrary files are served.
for it in list(items):
 if it['kind']!='html':continue
 p=Path(it['path'])
 for ref in re.findall(r'(?:src|href)=[\"\x27]([^\"\x27]+)',(ROOT/p).read_text(errors='replace')):
  if ref.startswith(('http:','https:','#','data:','/')) or '${' in ref:continue
  dest=(ROOT/p.parent/ref.split('?')[0]).resolve()
  if dest.is_relative_to(ROOT) and dest.is_file() and dest.suffix.lower() in image_ext|{'.html','.css','.js'}:allowed.add(dest.relative_to(ROOT).as_posix())
live=[('当前产品 · 首页','http://127.0.0.1:5174/','mvp/src/components/v3/Dashboard.tsx','当前产品'),('当前产品 · API 设置','http://127.0.0.1:5174/settings/api-key','mvp/src/components/v3/settings/ApiKeySettings.tsx','当前产品'),('模型设置设计预览','http://127.0.0.1:5174/model-settings-preview','mvp/src/components/v3/settings/ModelProviderSettingsPreview.tsx','当前产品'),('新版 · 首页','http://127.0.0.1:51910/','packages/web/src/pages/HomePage.tsx','新版开发'),('新版 · 搜索设置','http://127.0.0.1:51910/settings','packages/web/src/pages/SearchSettings.tsx','新版开发')]
for n,t in [('decomposing','拆句中'),('retrieving','检索中'),('contested','存在争议'),('done','完成结果'),('followup','追加问题')]:live.append(('新版 · '+t,'http://127.0.0.1:51910/cases/fx-'+n,'packages/web/fixtures/'+n+'.json','新版开发'))
for title,url,path,group in reversed(live):items.insert(0,dict(title=title,url=url,path=path,group=group,kind='live',featured=title in ['当前产品 · 首页','新版 · 完成结果'],note='本地运行的现有前端。新版案件为固定 fixture；不是新调查结果。' if group=='新版开发' else '现有 mvp 本地页面；首页可进入登录、历史与调查流程。'))
approved={'packages/web/output/show-me-parts/index.html','packages/web/output/show-me-walk/index.html'}
for it in items:
 if it['path'] in approved:
  it['featured']=True
  it['group']='认可的设计'
  it['note']='用户已认可设计（2026-09-05）。后续原型的视觉与交互基准；原稿内的旧开发状态仍按历史记录理解。'
for it in items:
 if it['kind']=='image' and (it['path'].startswith(('packages/web/output/show-me-parts/','packages/web/output/show-me-walk/')) or it['path']=='packages/web/output/acceptance/home-mvp-port-desktop.png'):
  it['group']='认可稿配图'
  it['note']='随用户认可稿保留的原始配图。'
items.sort(key=lambda it: it['path'] not in approved)
(OUT/'manifest.json').write_text(json.dumps(items,ensure_ascii=False,indent=2))
(OUT/'allowlist.json').write_text(json.dumps(sorted(allowed),ensure_ascii=False))
print(json.dumps(collections.Counter(i['group'] for i in items),ensure_ascii=False))
