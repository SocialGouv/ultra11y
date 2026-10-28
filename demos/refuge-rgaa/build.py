"""Generate the local refuge and its separate RGAA controls; never edits upstream."""
from pathlib import Path
import json,shutil,html,hashlib
R=Path(__file__).resolve().parent; REPO=R.parents[1]; P=R/'public';P.mkdir(exist_ok=True)
PACK=json.loads((REPO/'src/data/standards/rgaa.json').read_text(encoding='utf-8'));CRITERIA={c['id']:c for c in PACK['criteria']}
GROUPS={'animaux':('Animaux à adopter','Photos, portraits et nouvelles du refuge.','cat.jpg'),'rencontres':('Rencontrer nos animaux','Écoutez notre équipe et préparez votre visite.','socke.jpg'),'comparer':('Comparer les refuges','Places disponibles, adoptions et accompagnement.','sheep.jpg'),'adoption':('Demande d’adoption','Préparez votre dossier et votre première rencontre.','cat.jpg'),'dons':('Faire un don','Parrainez les animaux et suivez nos besoins.','alpaca.jpg'),'espace':('Mon espace','Conservez vos notes de préparation.','socke.jpg'),'documents':('Documents d’adoption','Les informations pratiques à télécharger.','horse.jpg'),'visite':('Visite interactive','Explorez les espaces du refuge.','alpaca.jpg'),'journal':('La vie du refuge','Témoignages et informations de nos bénévoles.','sheep.jpg'),'interactions':('Services du refuge','Notifications, disponibilités et réservation.','cat.jpg'),'navigation':('Guides et plan du site','Préparez votre parcours parmi nos services.','socke.jpg')}
# id | group | slug | natural title | exact test | defect expected in the negative case
DATA='''1.4|animaux|verification-image|Vérifier votre demande|1.4.1|Le CAPTCHA porte une alternative qui ne décrit ni sa nature ni sa fonction.
1.5|animaux|verification-acces|Confirmer votre demande|1.5.1|Le CAPTCHA ne propose aucune autre forme ni voie d’accès.
1.6|animaux|bilan-adoptions|Le bilan des adoptions|1.6.1|Le graphique chiffré ne possède aucune description détaillée.
1.7|animaux|evolution-adoptions|L’évolution des adoptions|1.7.1|La description associée contredit les données du graphique.
1.8|animaux|horaires|Les horaires du refuge|1.8.1|Le texte informatif est une image sans mécanisme de remplacement.
1.9|animaux|portrait|Le portrait de Socke|1.9.1|La légende n’est pas reliée à la photographie.
2.1|visite|carte-acces|La carte d’accès|2.1.1|L’iframe n’a pas de titre.
2.2|visite|itineraire|Votre itinéraire|2.2.1|Le titre du cadre décrit un contenu différent.
4.1|rencontres|annonce|Les horaires en audio|4.1.1|L’annonce audio informative ne possède pas de transcription.
4.2|rencontres|transcription|L’annonce de notre équipe|4.2.1|La transcription contredit les paroles de l’annonce.
4.3|rencontres|video|Votre prochaine visite|4.3.1|La vidéo parlée ne possède pas de sous-titres synchronisés.
4.4|rencontres|sous-titres|Le message de bienvenue|4.4.1|Les sous-titres sont faux et décalés.
4.5|rencontres|acces-video|Préparer votre arrivée|4.5.2|L’horaire et l’accès montrés à l’image ne sont pas décrits dans le son.
4.6|rencontres|description-video|La visite décrite|4.6.2|L’audiodescription annonce un jour, une heure et un accès incorrects.
4.7|rencontres|galerie|Galerie|4.7.1|Le média informatif n’est pas clairement identifié par son contenu adjacent.
4.8|visite|plan|Explorer les espaces|4.8.1|Le plan interactif canvas n’a pas d’alternative.
4.9|visite|plan-equivalent|Les capacités du refuge|4.9.1|L’alternative du plan omet deux zones et leurs fonctionnalités.
4.10|rencontres|ambiance|L’annonce à l’arrivée|4.10.1|Le son démarre automatiquement plus de trois secondes sans arrêt ni volume.
4.11|rencontres|lecteur|Regarder notre présentation|4.11.2|Les commandes de lecture et pause sont inaccessibles au clavier.
4.12|visite|plan-clavier|Choisir un espace|4.12.1|Les zones du plan sont activables au pointeur uniquement.
4.13|rencontres|commandes|La présentation interactive|4.13.1|Les commandes canvas du lecteur n’exposent ni nom, ni rôle, ni état.
5.1|comparer|bilan-trimestriel|Les adoptions par trimestre|5.1.1|Le tableau complexe n’a pas de résumé de son organisation.
5.2|comparer|lecture-bilan|Comprendre le bilan|5.2.1|Le résumé du tableau complexe décrit une autre organisation.
5.3|comparer|contacts|Adopter ou parrainer|5.3.1|Le tableau de mise en forme devient incohérent en lecture linéaire.
5.4|comparer|places|Places disponibles|5.4.1|Le titre visible n’est pas associé au tableau.
5.5|comparer|resultats|Les résultats des refuges|5.5.1|Le titre du tableau décrit des données météorologiques.
5.6|comparer|effectifs|Les effectifs accueillis|5.6.1|Les en-têtes de colonnes sont des cellules ordinaires.
5.7|comparer|detail-trimestres|Détail des résultats trimestriels|5.7.4|Les cellules de données complexes référencent les mauvais en-têtes.
5.8|comparer|fiches|Les fiches pratiques|5.8.1|Le tableau de mise en forme emploie des en-têtes de données.
7.2|interactions|disponibilites|Les disponibilités actualisées|7.2.2|L’alternative d’une image mise à jour par script reste périmée.
7.5|dons|parrainage|Parrainer un animal|7.5.1|Le message de confirmation dynamique n’a pas de rôle de statut.
8.7|journal|benevoles|Nos bénévoles internationaux|8.7.1|Le passage anglais ne déclare pas son changement de langue.
8.8|journal|temoignage|Le témoignage de Lucy|8.8.1|Le passage anglais est déclaré en allemand.
8.10|journal|accueil-arabe|Bienvenue à tous|8.10.1|Le passage arabe ne déclare pas son sens de lecture.
9.4|journal|paroles|Paroles d’adoptants|9.4.2|Un bloc de citation est balisé comme un simple paragraphe.
10.6|interactions|rendez-vous|Prendre rendez-vous|10.6.1|Le lien au milieu d’un paragraphe n’est distingué que par une couleur insuffisante.
10.8|interactions|conditions|Consulter les conditions|10.8.1|Le contenu révélé reste aria-hidden pour les technologies d’assistance.
10.13|interactions|aide|Aide à la réservation|10.13.1|Le panneau de survol recouvre de l’information sans pouvoir être fermé sans déplacer le pointeur.
10.14|interactions|conseil|Un conseil pour votre visite|10.14.1|Le conseil révélé au survol CSS n’est pas disponible au clavier.
11.3|adoption|contact|Votre adresse de contact|11.3.1|Deux champs de même fonction portent des étiquettes incohérentes.
11.5|adoption|foyer|Votre foyer|11.5.1|Les réponses Oui/Non à deux questions ne sont pas regroupées.
11.6|adoption|habitat|Votre habitat|11.6.1|Le regroupement de champs n’a pas de légende.
11.7|adoption|jardin|Votre jardin|11.7.1|La légende du groupe décrit un mode de paiement.
11.8|adoption|region|Choisir votre refuge|11.8.1|Les options de régions sont de faux titres sans regroupement.
11.10|adoption|depot|Déposer votre demande|11.10.3|La validation rejette la saisie sans identifier le champ en erreur.
11.11|adoption|code|Retrouver votre demande|11.11.1|La validation ne fournit pas le format attendu ni suggestion de correction.
11.12|espace|notes|Mes notes de préparation|11.12.1|La note persistante est supprimée immédiatement sans confirmation ni récupération.
12.1|navigation|guides|Les guides du refuge|12.1.1|L’ensemble hiérarchisé de guides ne possède qu’un système de navigation.
12.2|navigation|menus|Parcourir nos rubriques|12.2.1|Le même menu change de place entre deux pages intérieures.
12.3|navigation|plan|Plan des rubriques|12.3.3|Le plan omet une rubrique et associe un intitulé à la mauvaise destination.
12.4|navigation|acces-plan|Trouver le plan des rubriques|12.4.2|Le lien vers le plan change de place entre pages intérieures.
12.5|navigation|recherche|Rechercher dans les guides|12.5.2|L’accès à une recherche fonctionnelle change de place entre pages intérieures.
12.10|interactions|raccourcis|Parcourir les portraits|12.10.1|Le raccourci global N ne peut pas être désactivé ou reconfiguré.
12.11|interactions|options|Les options de visite|12.11.1|Le panneau dévoilé contient un lien exclu du parcours clavier.
13.1|interactions|reservation|Réserver une rencontre|13.1.4|La session expire et efface la saisie sans prolongation possible.
13.3|documents|dossier|Télécharger le dossier|13.3.1|Le PDF image ne possède aucune version accessible.
13.4|documents|version-texte|Le dossier et sa version texte|13.4.1|L’alternative HTML omet une condition et modifie le montant du PDF.
13.10|visite|portraits|Faire défiler les portraits|13.10.2|Le carrousel exige une trajectoire de balayage sans geste simple alternatif.
13.12|visite|surprise|Rencontrer un animal au hasard|13.12.1|Le choix exige un mouvement de l’appareil sans commande alternative.
'''
CASES=[]
for line in DATA.strip().splitlines():
 cid,group,slug,title,test,defect=line.split('|');assert test.rsplit('.',1)[1] in CRITERIA[cid]['tests']
 CASES.append(dict(id=cid,group=group,slug=slug,title=title,test=test,defect=defect))
assert len(CASES)==59 and len({x['id'] for x in CASES})==59
BASELINE=['1.4','1.5','1.6','1.7','1.8','1.9','2.1','2.2',*[f'4.{i}' for i in range(1,14)],*[f'5.{i}' for i in range(1,9)],'7.2','7.5','8.7','8.8','8.10','9.4','10.6','10.8','10.13','10.14','11.3','11.5','11.6','11.7','11.8','11.10','11.11','11.12','12.1','12.2','12.3','12.4','12.5','12.10','12.11','13.1','13.3','13.4','13.10','13.12']
assert set(BASELINE)=={x['id'] for x in CASES}
def esc(s):return html.escape(str(s),quote=True)
def write(route,text):
 dest=P/route.lstrip('/');dest=dest/'index.html' if route.endswith('/') else dest;dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_suffix(dest.suffix+'.tmp');tmp.write_text(text,encoding='utf-8');tmp.replace(dest)
def url(c,good=False):return ('/temoins' if good else '')+'/'+c['group']+'/'+c['slug']+'/'
def shell(title,body,group='',prefix='',nav=True,search=True,extra='',footer=True):
 links=''.join(f'<li><a href="/{k}/">{esc(GROUPS[k][0])}</a></li>' for k in ['animaux','adoption','dons','visite','navigation'])
 headsearch='<form role="search" action="/recherche.html"><label for="query">Rechercher</label><input id="query" type="search" name="q"><button>Rechercher</button></form>' if search else ''
 return f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)} — Le Refuge</title><link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/site.css">{extra}</head><body><a class="skip" href="#contenu">Aller au contenu</a><header><a href="/">Animal Shelter · Le Refuge</a>{headsearch}</header>{'<nav class="primary" aria-label="Navigation principale"><ul>'+links+'</ul></nav>' if nav else ''}<main id="contenu"><p class="eyebrow">{esc(GROUPS.get(group,('Le Refuge',))[0])}</p><h1>{esc(title)}</h1>{body}</main>{'<footer><p>Le Refuge · Démonstration locale. Les animaux et les démarches sont présentés à des fins de test.</p></footer>' if footer else ''}<script type="module" src="/assets/app.js"></script></body></html>'''
ANN='Le refuge vous accueille le samedi de quatorze heures à dix-huit heures. Entrez par le portail nord.'
GOODDOC='<h2>Dossier d’adoption</h2><p>Visite : samedi à 14 h, entrée nord.</p><p>Pièces : justificatif de domicile et pièce d’identité.</p><p>Participation : 120 euros.</p><p>Condition : accord de tous les adultes du foyer.</p><p>Contact : accueil@refuge.example</p>'
def video(file='visite.webm',track=None,controls=True):
 return f'<video id="video" preload="metadata" {"controls" if controls else ""} src="/assets/{file}" width="720" height="405">'+(f'<track kind="captions" src="/assets/{track}" srclang="fr" label="Français" default>' if track else '')+'</video>'
def maphtml(good,alternative=None):
 result='<canvas id="map" data-map width="600" height="180"></canvas><p id="map-result" role="status">Sélectionnez un espace pour connaître sa capacité.</p>'
 if good or alternative is not None:
  result=result.replace('</canvas>','</canvas><p><a href="#plan-html">Version HTML interactive du plan</a></p>')
  result+='<section id="plan-html" aria-label="Version HTML du plan"><h2>Choisir un espace</h2>'
  for x in (['Chats : 12 places','Chiens : 8 places','Soins : 4 places'] if good else ['Chats : 12 places']):result+=f'<button data-zone="{x}">{x}</button> '
  result+='</section>'
 return result
SUMMARY='Colonnes regroupées par trimestre, puis adoptions et retours ; une ligne par refuge.'
def complex_table(summary,correct=True):
 cap='Bilan des adoptions'+(' — '+summary if summary else '')
 s=f'<table id="fixture"><caption>{cap}</caption><thead><tr><th id="ref" rowspan="2">Refuge</th><th id="t1" colspan="2">Trimestre 1</th><th id="t2" colspan="2">Trimestre 2</th></tr><tr><th id="a1" headers="t1">Adoptions</th><th id="r1" headers="t1">Retours</th><th id="a2" headers="t2">Adoptions</th><th id="r2" headers="t2">Retours</th></tr></thead><tbody>'
 for n,name,values in [('n','Nord',[12,2,18,1]),('s','Sud',[8,1,14,2])]:
  s+=f'<tr><th id="{n}" headers="ref">{name}</th>'
  for i,v in enumerate(values):
   h=f'{n} '+(['t1 a1','t1 r1','t2 a2','t2 r2'][i] if correct else ['t2 r2','t2 a2','t1 r1','t1 a1'][i]);s+=f'<td headers="{h}">{v}</td>'
  s+='</tr>'
 return s+'</tbody></table>'
def simple_table(cid,good):
 caption='Places disponibles par refuge';s='<table id="fixture">'
 if cid=='5.4' and not good:before=f'<p>{caption}</p>'
 else:before='';s+=f'<caption>{"Prévisions météorologiques" if cid=="5.5" and not good else caption}</caption>'
 tag='td' if cid=='5.6' and not good else 'th';s+=f'<tr><{tag}'+(' scope="col"' if tag=='th' else ' style="font-weight:bold"')+f'>Refuge</{tag}><{tag}'+(' scope="col"' if tag=='th' else ' style="font-weight:bold"')+f'>Places</{tag}></tr>'
 s+='<tr><th scope="row">Nord</th><td>12</td></tr><tr><th scope="row">Sud</th><td>8</td></tr></table>';return before+s

def body(c,good):
 cid=c['id'];out='';actions=['Ouvrir la page et examiner le contenu ciblé.'];pre=[];method=['code','DOM']
 if cid in ['1.4','1.5']:
  alt='Photographie de vacances' if cid=='1.4' and not good else 'Contrôle anti-robot : recopiez les lettres de l’image.'
  out=f'<form data-captcha><p>Avant de transmettre votre demande, recopiez les lettres affichées.</p><img id="fixture" src="/assets/captcha.png" alt="{alt}" width="340" height="100"><p><label for="captcha">Code de vérification</label> <input id="captcha" name="captcha" autocomplete="off"></p><button>Transmettre la demande</button>'
  if good or cid=='1.4':out+='<button type="button" data-bypass>Transmettre sans vérification visuelle</button>'
  out+='<output role="status"></output></form>';actions=['Lire l’image et son alternative.','Saisir REFUGE puis transmettre ; vérifier les autres voies d’accès.'];method+=['image']
 elif cid in ['1.6','1.7']:
  desc=good or cid=='1.7';out='<img id="fixture" src="/assets/adoptions.png" alt="Adoptions au premier trimestre" width="900" height="490">'
  if desc:out+='<p><a href="#description">Description détaillée du graphique</a></p><div id="description"><p>'+('12 adoptions en janvier, 24 en février et 18 en mars. Le total est de 54 ; février est le mois le plus élevé.' if good else 'Aucune adoption pendant le trimestre. Tous les mois comptent zéro adoption.')+'</p></div>'
  method+=['image'];actions=['Comparer les barres et valeurs du graphique à la description éventuelle.']
 elif cid=='1.8':out='<p id="fixture" class="poster">Ouvert samedi de 14 h à 18 h</p>' if good else '<img id="fixture" src="/assets/horaires.png" alt="Ouvert samedi de 14 h à 18 h">';method+=['image']
 elif cid=='1.9':
  img='<img id="fixture" src="/photos/socke.jpg" alt="Un chien regarde l’appareil photo" width="450">';legend='Socke, notre compagnon du refuge.'
  out=f'<figure role="group" aria-label="{legend}">{img}<figcaption>{legend}</figcaption></figure>' if good else img+f'<p>{legend}</p>';method+=['image']
 elif cid in ['2.1','2.2']:
  title=' title="Plan d’accès au refuge, entrée nord"' if good else (' title="Cours des devises"' if cid=='2.2' else '')
  out=f'<iframe id="fixture" src="/cadre.html"{title} width="700" height="260"></iframe>'
 elif cid in ['4.1','4.2']:
  out='<audio id="fixture" controls src="/assets/annonce.wav"></audio>'
  if good or cid=='4.2':out+='<h2>Transcription de l’annonce</h2><p>'+ (ANN if good else 'Le refuge est fermé le samedi. Venez dimanche à seize heures par le portail sud.')+'</p>'
  actions=['Lire l’audio en entier.','Comparer les paroles à la transcription éventuelle.'];method+=['audio']
 elif cid in ['4.3','4.4','4.5','4.6','4.7','4.11','4.13']:
  source='visite.webm';track='captions.vtt';controls=True
  if cid=='4.3' and not good:track=None
  if cid=='4.4' and not good:track='captions-incorrectes.vtt'
  if cid=='4.5' and good:source='visite-decrite.webm'
  if cid=='4.6':source='visite-decrite.webm' if good else 'visite-description-incorrecte.webm'
  if cid in ['4.11','4.13'] and not good:controls=False
  out=('<p>Présentation des horaires et de l’accès au refuge'+(' — version avec audiodescription' if cid=='4.6' or cid=='4.5' and good else '')+'.</p>' if cid!='4.7' or good else '')+video(source,track,controls)
  if cid=='4.11' and not good:out+='<div id="fixture" class="media-click" data-player-toggle>Lire</div><p id="player-status"></p>'
  elif cid=='4.13' and not good:out+='<canvas id="fixture" data-player-canvas width="360" height="65"></canvas><p id="player-status"></p>'
  else:out+='<div id="fixture"></div>'
  if good and cid in ['4.5','4.6']:out+='<p><a href="sans-description.html">Version sans audiodescription</a></p>';write(url(c,True)+'sans-description.html',shell('Présentation sans audiodescription',video(track='captions.vtt'),c['group']))
  actions=['Lire les 18 secondes de vidéo, avec le son.','Afficher les sous-titres et comparer les paroles, l’image et les pistes.','Tester lecture, pause et commandes au clavier.'];method+=['video','audio','clavier']
 elif cid in ['4.8','4.9','4.12']:
  out=maphtml(good,alternative='incomplete' if cid=='4.9' else None);actions=['Cliquer chacune des trois zones.','Vérifier les informations résultantes et les possibilités équivalentes au clavier.'];method+=['interaction','clavier']
 elif cid=='4.10':
  out='<audio id="fixture" data-auto autoplay src="/assets/annonce.wav"></audio><p>Bienvenue dans l’espace des rencontres.</p>'
  if good:out+='<button data-stop-audio>Arrêter l’annonce sonore</button>'
  pre=['Autoriser explicitement la lecture sonore automatique dans un profil navigateur de test. En cas de blocage, le scénario NC n’est pas observé.'];actions=['Charger la page sans lancer la lecture par un clic.','Vérifier paused=false, muted=false et currentTime supérieur à 3 secondes.','Rechercher une commande d’arrêt ou de volume.'];method+=['audio','interaction']
 elif cid in ['5.1','5.2','5.7']:
  summary=SUMMARY if good or cid=='5.7' else ('' if cid=='5.1' else 'Chaque colonne est un animal ; les lignes donnent uniquement des horaires de visite.')
  out=complex_table(summary,correct=good or cid!='5.7');actions=['Examiner le résumé, les en-têtes et les associations de chaque cellule.']
 elif cid in ['5.4','5.5','5.6']:out=simple_table(cid,good)
 elif cid=='5.3':
  out='<table id="fixture"'+(' role="presentation"' if good else '')+'>'
  out+=('<tr><td>Pour adopter, contactez Léa.</td><td>Pour parrainer, contactez Marc.</td></tr>' if good else '<tr><td>Pour adopter,</td><td>Pour parrainer,</td></tr><tr><td>contactez Léa.</td><td>contactez Marc.</td></tr>')+'</table>';actions=['Lire les cellules dans leur ordre DOM, sans la disposition en colonnes.']
 elif cid=='5.8':out='<table id="fixture"'+(' role="presentation"><tr><td>Appelez-nous</td><td>Venez nous rencontrer</td></tr>' if good else ' role="presentation"><caption>Nos conseils</caption><tr><th id="a">Appelez-nous</th><th id="b">Venez nous rencontrer</th></tr><tr><td headers="a"><p>Un bénévole vous répondra pour préparer votre rencontre.</p></td><td headers="b"><p>Nous vous accueillerons avec votre dossier.</p></td></tr>')+'</table>'
 elif cid=='7.2':
  out='<img id="status-image" src="/assets/captcha.png" alt="Les lettres REFUGE"><p><button id="fixture" data-graph-toggle'+(' data-sync-alt' if good else '')+'>Afficher les horaires</button></p>';actions=['Activer Afficher les horaires.','Comparer le texte de l’image avec son alternative après la mise à jour.'];method+=['image','interaction']
 elif cid=='7.5':out='<button id="fixture" data-status-action>Parrainer Socke</button><p id="result"'+(' role="status"' if good else '')+'></p>';actions=['Activer Parrainer Socke sans déplacer le focus.','Vérifier le rôle du message et sa restitution avec un lecteur d’écran.'];method+=['interaction','technologie-assistance']
 elif cid in ['8.7','8.8']:out='<p id="fixture"'+(' lang="en"' if good else (' lang="de"' if cid=='8.8' else ''))+'>We welcome visitors every Saturday. Please bring your adoption application and meet our volunteers at the north entrance.</p>'
 elif cid=='8.10':out='<p id="fixture" lang="ar"'+(' dir="rtl"' if good else '')+'>نرحب بكم في الملجأ يوم السبت. يرجى الدخول من البوابة الشمالية.</p>'
 elif cid=='9.4':out=('<blockquote id="fixture"><p>' if good else '<p id="fixture">')+'« Nous avons rencontré Socke au refuge. L’équipe nous a accompagnés à chaque étape de son adoption. »'+('</p></blockquote>' if good else '</p>')+'<p>Témoignage de Camille, adoptante.</p>'
 elif cid=='10.6':out='<p>Pour organiser votre venue, consultez les <a id="fixture" href="/adoption/"'+(' class="inline-link-correct"' if good else ' class="inline-link-low"')+'>modalités d’adoption</a> avant de préparer votre dossier.</p>';method+=['rendu']
 elif cid=='10.8':out='<button id="fixture" data-reveal="conditions" aria-expanded="false" aria-controls="conditions"'+(' data-restore-semantics' if good else '')+'>Afficher les conditions</button><div id="conditions" hidden aria-hidden="true"><p>L’accord de tous les adultes du foyer est nécessaire pour adopter.</p></div>';actions=['Activer Afficher les conditions.','Comparer la visibilité du texte à sa présence dans l’arbre d’accessibilité.'];method+=['interaction','technologie-assistance']
 elif cid in ['10.13','10.14','12.11']:
  out='<div class="hover-wrap'+(' keyboard-panel' if good or cid in ['10.13','12.11'] else '')+'"><button id="fixture">Conseils de visite</button><div class="hover-panel">'
  out+='Arrivez dix minutes avant votre rendez-vous.'
  if cid=='12.11':out+='<p><a href="/adoption/"'+('' if good else ' tabindex="-1"')+'>Préparer la demande</a></p>'
  out+='</div></div><div class="target-copy"><h2>Votre réservation</h2><p>Votre dossier doit être présenté à l’accueil du refuge.</p></div>'
  if cid=='10.13':out+='<style>#scenario .hover-wrap{margin-bottom:0}#scenario .target-copy{padding:0}#scenario .target-copy h2{margin:0}</style>'
  if not good and cid=='10.13':out+='<style>.hover-wrap.keyboard-panel .hover-panel{display:none}.hover-wrap.keyboard-panel:hover .hover-panel,.hover-wrap.keyboard-panel:focus-within .hover-panel{display:block}.hover-wrap.dismissed .hover-panel{display:block!important}</style>'
  actions=['Survoler Conseils de visite, puis essayer le même parcours au clavier.','Appuyer sur Échap sans déplacer le pointeur.','Parcourir le contenu additionnel avec Tab.'];method+=['interaction','rendu','clavier']
 elif cid=='11.3':
  out=''
  for i,label in enumerate(['Adresse électronique de contact','Adresse électronique de contact' if good else 'Identifiant du dossier']):out+=f'<form data-simple-form><h2>{["Demande d’adoption","Suivi de la demande"][i]}</h2><p>Nous utilisons cette adresse électronique pour vous répondre.</p><label for="email{i}">{label}</label> <input id="email{i}" type="email" name="email" autocomplete="email"><button>Enregistrer</button><output role="status"></output></form>'
 elif cid in ['11.5','11.6','11.7']:
  out='<form data-simple-form>'
  for i,q in enumerate(['Avez-vous un jardin ?','Avez-vous déjà un animal ?']):
   out+=f'<p>{q}</p>';grouped=good or cid!='11.5';out+='<fieldset>' if grouped else '<div>'
   if good or cid=='11.7':out+='<legend>'+(q if good else 'Mode de paiement')+'</legend>'
   out+=f'<label><input type="radio" name="q{i}" value="oui"> Oui</label> <label><input type="radio" name="q{i}" value="non"> Non</label>'
   out+='</fieldset>' if grouped else '</div>'
  out+='<button>Enregistrer</button><output role="status"></output></form>'
 elif cid=='11.8':
  options='<optgroup label="Bretagne"><option>Rennes</option><option>Brest</option></optgroup><optgroup label="Île-de-France"><option>Paris</option><option>Versailles</option></optgroup>' if good else '<option disabled>Bretagne</option><option>Rennes</option><option>Brest</option><option disabled>Île-de-France</option><option>Paris</option><option>Versailles</option>'
  out='<form data-simple-form><label for="fixture">Votre refuge</label> <select id="fixture">'+options+'</select><button>Choisir ce refuge</button><output role="status"></output></form>'
 elif cid in ['11.10','11.11']:
  message='Le code de demande doit contenir AD- suivi de quatre chiffres, par exemple AD-2048.' if good else ('Erreur' if cid=='11.10' else 'Code incorrect.')
  out=f'<form id="fixture" novalidate data-validation="{message}"><p><label for="code">Code de demande'+(' (obligatoire)' if good else '')+'</label> <input id="code" name="code"'+(' aria-describedby="format" required' if good else '')+'></p>'
  if good:out+='<p id="format">Format attendu : AD- suivi de quatre chiffres, par exemple AD-2048.</p>'
  out+='<p><label for="comment">Commentaire</label> <input id="comment" name="comment"></p><button>Valider</button><output id="validation-result"'+(' role="alert"' if good else '')+'></output></form>';actions=['Saisir XYZ dans Code de demande et valider.','Examiner les instructions avant saisie et l’erreur après rejet.','Vérifier que AD-2048 est accepté.'];method+=['interaction']
 elif cid=='11.12':
  out='<div id="fixture" data-notes><label for="note">Ma note de préparation</label><p><textarea id="note" rows="4"></textarea></p><button data-save>Enregistrer la note</button><form><button>Supprimer la note</button></form>'
  if good:
   out=out.replace('<form><button>Supprimer la note</button></form>','<form><label><input type="checkbox" required> Je confirme la suppression de ma note.</label><button>Supprimer la note</button></form>')
   out+='<p>Après suppression, vous pouvez aussi choisir « Annuler la suppression » tant que vous ne quittez ni ne rechargez cette page.</p><button data-undo hidden>Annuler la suppression</button>'
  out+='<output role="status"></output></div>';actions=['Créer une note et l’enregistrer.','Recharger la page pour vérifier sa persistance.','Supprimer la note et chercher un moyen de confirmation ou récupération.'];method+=['interaction','stockage-local']
 elif cid.startswith('12.') and cid in ['12.1','12.2','12.3','12.4','12.5']:
  out=navcase(c,good)
  actions=(['Depuis l’accueil du sous-site, ouvrir rubrique-0.html puis guide-0-0.html et parcourir les autres rubriques et conseils.','Relever les systèmes de navigation disponibles sur ces pages : menu, plan et recherche.'] if cid=='12.1' else ['Parcourir le sous-site de guides et ses pages intérieures.','Comparer les moyens de navigation sur page-a.html et page-b.html.'])
  method+=['multi-pages','rendu']
 elif cid=='12.10':out='<div data-shortcut id="fixture"><p>Appuyez sur N pour passer au portrait suivant.</p>'+('<label><input type="checkbox" data-shortcut-enabled checked> Activer le raccourci N</label>' if good else '')+'<button data-next>Animal suivant</button><output role="status">Mina, le chat</output></div>';actions=['Avec le focus sur la page, appuyer sur N.','Chercher un moyen de désactiver ou reconfigurer le raccourci.'];method+=['clavier']
 elif cid=='13.1':out='<div data-session id="fixture"><p data-countdown>Temps restant : 15 s</p>'+('<button data-disable-timer>Supprimer la limite de temps</button>' if good else '')+'<form><label for="session-note">Préparer ma rencontre</label><textarea id="session-note"></textarea></form></div>';actions=['Saisir une note et attendre 16 secondes.','Vérifier les possibilités de prolonger ou supprimer la limite avant expiration.'];method+=['temps','interaction']
 elif cid in ['13.3','13.4']:
  out='<p><a id="fixture" href="/assets/dossier-adoption.pdf" download>Dossier d’adoption (PDF)</a></p>'
  if good or cid=='13.4':
   out+='<p><a href="version-accessible.html">Version HTML du dossier d’adoption</a></p>';content=GOODDOC if good else '<h2>Dossier d’adoption</h2><p>Visite : samedi à 14 h, entrée nord.</p><p>Pièces : justificatif de domicile et pièce d’identité.</p><p>Participation : 80 euros.</p><p>Contact : accueil@refuge.example</p>'
   write(url(c,good)+'version-accessible.html',shell('Version HTML du dossier',content,c['group']))
  actions=['Ouvrir le PDF et vérifier sa couche textuelle et sa structure.','Comparer le document avec la version HTML lorsqu’elle existe.'];method+=['document','image']
 elif cid=='13.10':out='<p>Balayez le portrait horizontalement pour rencontrer un autre animal.</p><div id="fixture" class="swipe-card" data-swipe><h2>Mina</h2><img src="/photos/cat.jpg" alt="Mina"></div>'+('<div class="actions"><button data-swipe-prev>Animal précédent</button><button data-swipe-next>Animal suivant</button></div>' if good else '');actions=['Effectuer un balayage horizontal de plus de 70 pixels, avec moins de 40 pixels de déplacement vertical.','Chercher une commande offrant le même résultat par clic simple.'];method+=['geste','interaction']
 elif cid=='13.12':out='<div data-motion id="fixture"><p>Secouez votre appareil pour découvrir un animal.</p><button data-motion-permission>Autoriser le capteur de mouvement</button><p data-motion-help>Cette fonction nécessite un appareil doté d’un capteur.</p>'+('<label><input type="checkbox" data-motion-enabled checked> Activer les mouvements</label><button data-choose>Choisir un animal</button>' if good else '')+'<output role="status">Mina, le chat</output></div>';pre=['Appareil avec capteur devicemotion et permission accordée. Un événement synthétique vérifie le branchement logiciel, pas le capteur physique.'];actions=['Autoriser le capteur si nécessaire, puis secouer l’appareil.','Chercher une commande alternative et un réglage désactivant le mouvement.'];method+=['capteur','interaction']
 else:raise ValueError(cid)
 return out,actions,pre,method

def navcase(c,good):
 base=url(c,good);cid=c['id']
 labels=[('page-a.html','Préparer une adoption'),('page-b.html','Accueillir un animal'),('documents.html','Documents'),('equipe.html','L’équipe')]
 menu='<nav class="primary" aria-label="Rubriques des guides"><ul>'+''.join(f'<li><a href="{base}{file}">{title}</a></li>' for file,title in labels)+'</ul></nav>'
 def localdoc(title,content,before='',after=''):
  return shell(title,before+content+after,c['group'],nav=False,search=False)
 sitemap='<section><h2>Plan des guides</h2><ul>'+''.join(f'<li><a href="{file}">{label}</a></li>' for file,label in labels if good or cid!='12.3' or file!='equipe.html')+'</ul></section>'
 if not good and cid=='12.3':sitemap=sitemap.replace('href="documents.html"','href="equipe.html"')
 search='<form data-local-search role="search"><label for="local-query">Rechercher un guide</label> <input id="local-query" type="search"><button>Rechercher</button></form><ul data-local-results hidden>'+''.join(f'<li><a href="{base}{f}">{t}</a></li>' for f,t in labels)+'</ul>'
 planlink='<p><a href="'+base+'plan.html">Plan des guides</a></p>'
 if cid=='12.1':
  # A nested, self-contained 17-page collection. The global search indexes neither its contents nor its full map.
  topics=['Preparation','Accueil','Sante','Vie quotidienne']
  menu='<nav class="primary" aria-label="Rubriques des guides"><ul>'+''.join(f'<li><a href="{base}rubrique-{i}.html">{t}</a></li>' for i,t in enumerate(topics))+'</ul></nav>'
  all_links=[]
  for i,topic in enumerate(topics):
   children=[]
   for j in range(3):
    fname=f'guide-{i}-{j}.html';title=f'{topic} — conseil {j+1}';all_links.append((fname,title));children.append(f'<li><a href="{fname}">{title}</a></li>')
    write(base+fname,localdoc(title,'<p>Prévoyez un espace calme, un rendez-vous et un suivi avec notre équipe.</p>',menu,planlink if good else ''))
   write(base+f'rubrique-{i}.html',localdoc(topic,'<ul>'+''.join(children)+'</ul>',menu,planlink if good else ''))
  if good:write(base+'plan.html',localdoc('Plan complet des guides','<ul>'+''.join(f'<li><a href="{f}">{t}</a></li>' for f,t in all_links)+'</ul>',menu))
  return '<p>Ces guides forment une collection autonome. Choisissez une rubrique, puis un conseil.</p>'+menu+(planlink if good else '')
 write(base+'plan.html',localdoc('Plan des guides',sitemap,(search if cid=='12.5' and good else '')+menu,planlink if cid=='12.4' else ''))
 for file,title in labels:
  before=menu;after='';content='<p>Découvrez les conseils et les documents proposés par les bénévoles.</p>'
  if cid=='12.2' and file=='page-b.html' and not good:before='';after=menu
  if cid=='12.4':
   if file=='page-b.html' and not good:before=planlink+before
   else:after+=planlink
  elif cid!='12.1':after+=planlink
  if cid=='12.5':
   if file=='page-b.html' and not good:after+=search
   else:before=search+before
  write(base+file,localdoc(title,content,before,after))
 return ((search if cid=='12.5' and good else '')+menu+'<p>Consultez les rubriques de cet ensemble de guides.</p>'+(sitemap if cid=='12.3' else '')+(search if cid=='12.5' and not good else '')+(planlink if cid in ['12.2','12.4'] else ''))

for file in ['site.css','app.js','favicon.svg']:shutil.copy2(R/'src'/file,P/'assets'/file)
shutil.copytree(REPO/'demos/microsoft-edge-a11y/photos',P/'photos',dirs_exist_ok=True)
shutil.copy2(REPO/'demos/microsoft-edge-a11y/UPSTREAM-LICENSE',P/'UPSTREAM-LICENSE')
write('/cadre.html','<!doctype html><html lang="fr"><meta charset="utf-8"><title>Accès au refuge</title><body><h1>Accès au refuge</h1><p>Entrée nord, samedi de 14 h à 18 h. L’accueil se trouve après le portail.</p></body></html>')
entries=[];searchitems=[]
for c in CASES:
 for good in [False,True]:
  content,actions,pre,method=body(c,good)
  isolated=c['id'] in ['12.1','12.2','12.3','12.4','12.5']
  page=shell(c['title'],'<section class="scenario" id="scenario">'+content+'</section>',c['group'],nav=not isolated,search=not isolated)
  write(url(c,good),page)
  if not good:
   # Search deliberately excludes navigation sub-sites, preserving their explicit audit boundaries.
   if c['group']!='navigation':searchitems.append({'title':c['title'],'url':url(c),'group':GROUPS[c['group']][0]})
   entry={**c,'criterionTitle':CRITERIA[c['id']]['titlePlain']['fr'],'normativeWording':CRITERIA[c['id']]['tests'][c['test'].rsplit('.',1)[1]],'bad':{'url':url(c),'expected':'NC','selector':'#scenario'},'control':{'url':url(c,True),'expected':['C','NA'] if c['id']=='1.8' else ['C'],'scope':'Critère ciblé uniquement ; pas une certification de toute la page.'},'actions':actions,'preconditions':pre,'evidenceRequired':method,'observedVerdict':None}
   if isolated:entry['auditScope']=url(c)+' et ses pages descendantes ; sous-site autonome. Ne pas utiliser le catalogue de test comme système de navigation.'
   if c['id']=='11.10':entry['actions'].insert(0,'Valider une première fois avec Code de demande vide pour tester 11.10.3.')
   entries.append(entry)
for group,(title,intro,photo) in GROUPS.items():
 cards=''.join(f'<article class="card"><h2><a href="{url(c)}">{esc(c["title"])}</a></h2><p>Consulter cette rubrique du refuge.</p></article>' for c in CASES if c['group']==group)
 write('/'+group+'/',shell(title,f'<p class="lead">{intro}</p><div class="cards">{cards}</div>',group))
 searchitems.append({'title':title,'url':'/'+group+'/','group':title})
cards=''.join(f'<article class="card"><img src="/photos/{photo}" alt="" loading="lazy"><h2><a href="/{group}/">{title}</a></h2><p>{intro}</p></article>' for group,(title,intro,photo) in GROUPS.items())
home='<div class="hero"><div><p class="lead">Une rencontre peut tout changer. Préparez votre visite, découvrez nos animaux et échangez avec les bénévoles.</p><p><a class="button" href="/animaux/">Découvrir les animaux</a></p><p class="notice">Site de démonstration : les parcours contiennent volontairement des défauts d’accessibilité. Aucune demande ni aucun paiement n’est transmis.</p></div><img src="/photos/cat.jpg" alt="Un chat du refuge se repose à l’extérieur"></div><h2>La vie du refuge, à votre rythme</h2><div class="cards">'+cards+'</div>'
write('/',shell('Bienvenue au refuge',home))
write('/recherche.html',shell('Rechercher dans le refuge','<p>Recherchez un animal, une démarche ou un service. Les collections autonomes de guides se parcourent depuis leur rubrique.</p><ul data-search-results></ul>'))
(P/'search-index.json').write_text(json.dumps(searchitems,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
# Do not expose the oracle or control links in the crawled site. They belong to the operator's separate catalogue.
manifest={'schemaVersion':1,'standard':'RGAA 4.1.2','baseUrl':'http://127.0.0.1:8765','contract':'Étendre la démo en refuge navigable ; couvrir par fixtures les 59 critères NA du précédent audit, avec cas NC et témoins séparés, actions reproductibles et ressources réelles. Ne pas modifier le moteur ultra11y ni la copie Microsoft.','baseline':'audits/microsoft-edge-a11y-20261028/tableaux/criteres-par-methode.json','targetCriteria':BASELINE,'targetCount':59,'warning':'Les verdicts sont attendus par conception, pas des résultats mesurés. La présence de 59 scénarios ne prouve pas 59 détections. Les témoins ne certifient que le critère ciblé.','cases':entries}
(R/'expected-results.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
rows=''.join('<tr><th scope="row">'+esc(c['id'])+'</th><td>'+esc(c['criterionTitle'])+'</td><td><a target="_blank" rel="noopener" href="http://127.0.0.1:8765'+c['bad']['url']+'">Ouvrir le cas NC attendu</a></td><td><a target="_blank" rel="noopener" href="http://127.0.0.1:8765'+c['control']['url']+'">Ouvrir le témoin</a></td><td>'+esc(c['defect'])+'<ol>'+''.join('<li>'+esc(a)+'</li>' for a in c['actions'])+'</ol>'+('<p><strong>Condition :</strong> '+esc(' '.join(c['preconditions']))+'</p>' if c['preconditions'] else '')+'</td></tr>' for c in entries)
(R/'catalogue.html').write_text('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalogue des scénarios RGAA du refuge</title><style>body{font:16px/1.5 system-ui;margin:24px;color:#172330}table{border-collapse:collapse}th,td{border:1px solid #9caaba;padding:12px;text-align:left;vertical-align:top}a{color:#174f85}caption{text-align:left;font-weight:bold;margin:20px 0}thead{background:#edf3f8}:focus-visible{outline:3px solid #a03000}</style><main><h1>59 scénarios RGAA, chacun avec un témoin distinct</h1><p>Ce catalogue est un outil de test, en dehors du site audité. Les résultats attendus ne sont pas des verdicts observés d’ultra11y. Ne pas fournir cet oracle au juge LLM avant son audit.</p><p><a href="http://127.0.0.1:8765/">Ouvrir le refuge</a> · <a href="expected-results.json">Manifeste et procédures JSON</a></p><div style="overflow:auto"><table><caption>Cas négatifs et témoins par critère RGAA</caption><thead><tr><th>Critère</th><th>Intitulé</th><th>Cas négatif</th><th>Témoin</th><th>Défaut et procédure</th></tr></thead><tbody>'+rows+'</tbody></table></div></main></html>',encoding='utf-8')
print(json.dumps({'cases':len(entries),'controls':len(entries),'pages':len(list(P.rglob('*.html'))),'public':str(P)},ensure_ascii=False))
