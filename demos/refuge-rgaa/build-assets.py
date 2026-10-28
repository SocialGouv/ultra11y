"""Build original, local fixture assets. Requires Pillow, ffmpeg and espeak-ng."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import subprocess,json,hashlib,tempfile
ROOT=Path(__file__).resolve().parent; OUT=ROOT/'public/assets';OUT.mkdir(parents=True,exist_ok=True)
GENERATED_MEDIA=['captcha.png','horaires.png','adoptions.png','visite.png','dossier.png','dossier-adoption.pdf','annonce.wav','visite.webm','visite-decrite.webm','visite-description-incorrecte.webm','captions.vtt','captions-incorrectes.vtt']
FONT=subprocess.check_output(['fc-match','-f','%{file}','sans'],text=True).strip()
def picture(name,size,lines):
 im=Image.new('RGB',size,'#f8f8f8');d=ImageDraw.Draw(im)
 for text,x,y,n,color in lines:d.text((x,y),text,font=ImageFont.truetype(FONT,n),fill=color)
 im.save(OUT/name);return im
picture('captcha.png',(340,100),[('R E F U G E',22,28,38,'#193d68')])
picture('horaires.png',(700,130),[('Ouvert samedi de 14 h à 18 h',20,40,35,'#193d68')])
chart=picture('adoptions.png',(900,490),[('Adoptions au premier trimestre',30,20,30,'#193d68')]);d=ImageDraw.Draw(chart)
for x,v,month in [(200,12,'Janvier'),(420,24,'Février'),(640,18,'Mars')]:
 d.rectangle((x,410-v*12,x+100,410),fill='#286a9e');d.text((x+25,370-v*12),str(v),font=ImageFont.truetype(FONT,26),fill='#172330')
 d.text((x+50,430),month,font=ImageFont.truetype(FONT,26),fill='#172330',anchor='mt')
chart.save(OUT/'adoptions.png')
poster=picture('visite.png',(960,540),[('Votre prochaine visite au refuge',65,65,40,'#193d68'),('Rendez-vous samedi à 14 h',65,220,48,'#172330'),('Entrée nord',65,320,48,'#172330')])
doclines=['Dossier d’adoption — Le Refuge','Visite : samedi à 14 h, entrée nord.','Pièces : justificatif de domicile et pièce d’identité.','Participation : 120 euros.','Condition : accord de tous les adultes du foyer.','Contact : accueil@refuge.example']
im=picture('dossier.png',(1240,1754),[(t,60,100+i*150,32 if i else 42,'#172330') for i,t in enumerate(doclines)])
im.save(OUT/'dossier-adoption.pdf','PDF',resolution=150)
texts={'annonce':'Le refuge vous accueille le samedi de quatorze heures à dix-huit heures. Entrez par le portail nord.', 'intro':'Bienvenue au refuge. Voici les informations pour votre visite.', 'description':'Un panneau indique : rendez-vous samedi à quatorze heures. Entrée nord.', 'description-incorrecte':'Un panneau indique : rendez-vous dimanche à seize heures. Entrée sud.'}
def run(*args,input=None):subprocess.run(args,input=input,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
with tempfile.TemporaryDirectory(prefix='refuge-media-') as tmp:
 tmp=Path(tmp)
 for key,text in texts.items():run('espeak-ng','-v','fr-fr','-s','145','-w',str(tmp/(key+'.wav')),'-b','1','--stdin',input=text.encode('utf-8'))
 run('ffmpeg','-y','-i',str(tmp/'annonce.wav'),'-c:a','pcm_s16le',str(OUT/'annonce.wav'))
 for name,desc in [('visite',None),('visite-decrite','description'),('visite-description-incorrecte','description-incorrecte')]:
  args=['ffmpeg','-y','-loop','1','-i',str(OUT/'visite.png'),'-i',str(tmp/'intro.wav')]
  if desc:args+=['-i',str(tmp/(desc+'.wav')),'-filter_complex','[1:a]apad[a];[2:a]adelay=7000|7000[b];[a][b]amix=inputs=2:normalize=0[out]','-map','0:v','-map','[out]']
  else:args+=['-af','apad','-map','0:v','-map','1:a']
  args+=['-t','18','-r','12','-c:v','libvpx-vp9','-b:v','180k','-pix_fmt','yuv420p','-c:a','libopus',str(OUT/(name+'.webm'))];run(*args)
(OUT/'captions.vtt').write_text('WEBVTT\n\n00:00.000 --> 00:05.500\nBienvenue au refuge. Voici les informations pour votre visite.\n',encoding='utf-8')
(OUT/'captions-incorrectes.vtt').write_text('WEBVTT\n\n00:08.000 --> 00:12.000\nLe refuge est fermé définitivement.\n',encoding='utf-8')
manifest={'origin':'Assets originaux synthétiques créés pour le banc de test ; aucun service distant.','speech':texts,'visualContent':['Votre prochaine visite au refuge','Rendez-vous samedi à 14 h','Entrée nord'],'document':doclines,'files':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in sorted(GENERATED_MEDIA)}}
(ROOT/'asset-provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Assets créés :',len(manifest['files']))
