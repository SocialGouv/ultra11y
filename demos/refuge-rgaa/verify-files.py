"""Validate fixture packaging and the separation between oracle and audited pages."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import json,hashlib
R=Path(__file__).resolve().parent;P=R/'public';REPO=R.parents[1]
m=json.loads((R/'expected-results.json').read_text(encoding='utf-8'));pack={c['id']:c for c in json.loads((REPO/'src/data/standards/rgaa.json').read_text(encoding='utf-8'))['criteria']}
class Page(HTMLParser):
 def __init__(self,text):super().__init__();self.links=[];self.assets=[];self.ids=[];self.feed(text)
 def handle_starttag(self,t,attrs):
  a=dict(attrs)
  if 'id' in a:self.ids.append(a['id'])
  if t=='a' and 'href' in a:self.links.append(a['href'])
  for k in ['src','poster']:
   if k in a:self.assets.append(a[k])
  if t=='link' and 'href' in a:self.assets.append(a['href'])
files={p:Page(p.read_text(encoding='utf-8')) for p in P.rglob('*.html')};graph={};problems=[]
def resolve(source,url):
 u=urlsplit(url)
 if u.scheme or u.netloc:return None,u.fragment
 path=(P/unquote(u.path).lstrip('/')) if u.path.startswith('/') else (source.parent/unquote(u.path) if u.path else source)
 if path.is_dir():path=path/'index.html'
 return path.resolve(),unquote(u.fragment)
for p,data in files.items():
 if len(data.ids)!=len(set(data.ids)):problems.append(f'Duplicate IDs: {p}')
 graph[p.resolve()]=[]
 for link in data.links+data.assets:
  dest,frag=resolve(p,link)
  if dest is None:continue
  if not dest.is_relative_to(P.resolve()):problems.append(f'Escaping public: {link}');continue
  if not dest.exists():problems.append(f'Missing {p.relative_to(P)}: {link}');continue
  if frag and dest.suffix=='.html' and frag not in files[dest].ids:problems.append(f'Missing anchor {p}: {link}')
  if link in data.links and dest.suffix=='.html':graph[p.resolve()].append(dest)
seen=set();todo=[(P/'index.html').resolve()]
while todo:
 p=todo.pop()
 if p not in seen:seen.add(p);todo+=graph.get(p,[])
assert len(m['cases'])==len({c['id'] for c in m['cases']})==59
for c in m['cases']:
 assert c['test'].startswith(c['id']+'.') and c['test'].split('.')[-1] in pack[c['id']]['tests']
 for kind in ['bad','control']:
  p=P/c[kind]['url'].strip('/')/'index.html';assert p.exists(),p
  if kind=='bad':assert p.resolve() in seen,c['id']
  else:assert p.resolve() not in seen,('Control exposed in negative crawl',c['id'])
 assert c['observedVerdict'] is None
assert not (P/'expected-results.json').exists()
media=json.loads((R/'asset-provenance.json').read_text(encoding='utf-8'))['files']
for name,digest in media.items():
 assert Path(name).name==name and Path(name).suffix in {'.png','.pdf','.wav','.webm','.vtt'},('Non-media provenance entry',name)
 assert hashlib.sha256((P/'assets'/name).read_bytes()).hexdigest()==digest,('Media digest mismatch',name)
up=REPO/'demos/microsoft-edge-a11y';manifest=json.loads((up/'upstream-provenance.json').read_text(encoding='utf-8'))
assert all(hashlib.sha256((up/x['path']).read_bytes()).hexdigest()==x['sha256'] for x in manifest['files'])
assert not problems,'\n'.join(problems)
print(json.dumps({'ok':True,'pages':len(files),'negativePagesReachable':len(seen),'negativeCases':59,'separateControls':59,'mediaHashesVerified':len(media),'upstreamFilesUnchanged':len(manifest['files']),'linkErrors':problems},indent=2))
