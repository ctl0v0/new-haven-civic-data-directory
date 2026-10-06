import json, re, urllib.request, urllib.parse
from html.parser import HTMLParser
class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.current=None; self.title=[]; self.in_title=False
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag=='title': self.in_title=True
        if tag=='a' and values.get('href'): self.current={'href':values['href'],'parts':[]}
    def handle_data(self,data):
        if self.in_title: self.title.append(data)
        if self.current is not None: self.current['parts'].append(data)
    def handle_endtag(self,tag):
        if tag=='title': self.in_title=False
        if tag=='a' and self.current is not None:
            self.links.append({'href':self.current['href'],'label':' '.join(' '.join(self.current['parts']).split())})
            self.current=None
def request(url,limit=3000000):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='https' or not (parsed.hostname=='newhavenct.gov' or parsed.hostname.endswith('.newhavenct.gov')): raise ValueError('Unapproved official source host')
    req=urllib.request.Request(url,headers={'User-Agent':'NewHavenCivicDataDirectory/1.0 source validation','Accept':'text/html,application/pdf'})
    with urllib.request.urlopen(req,timeout=25) as response:
        content=response.read(limit+1)
        if len(content)>limit: raise ValueError('Source exceeds bounded download size')
        return content,response.headers.get('Content-Type',''),response.geturl()
indexes=[
('monthly','https://www.newhavenct.gov/government/departments-divisions/office-of-policy-management-and-grants/monthly-reports'),
('annual','https://www.newhavenct.gov/government/departments-divisions/office-of-policy-management-and-grants/annual-city-budgets-audits')]
failed=False
for name,url in indexes:
    result={'name':'Finance '+name+' index','url':url}
    try:
        content,kind,resolved=request(url)
        parser=IndexParser(); parser.feed(content.decode('utf-8','replace'))
        title=' '.join(parser.title)
        if 'New Haven' not in title or ('report' not in title.lower() and 'budget' not in title.lower()): raise ValueError('Expected finance index page title not found')
        documents=[]; seen=set()
        for link in parser.links:
            target=urllib.parse.urljoin(resolved,link['href'])
            path=urllib.parse.urlparse(target).path.lower()
            if not ('showpublisheddocument' in path or path.endswith(('.pdf','.xlsx','.xls','.csv'))): continue
            if target in seen: continue
            seen.add(target); documents.append({'url':target,'label':link['label']})
        result.update(title=title,document_links_found=len(documents),documents=documents[:30],scope='Official index retrieval and document discovery only; downloads and extraction are not yet tested')
        if not documents: raise ValueError('No expected finance document links found')
        result['status']='passed'
    except Exception as error:
        result.update(status='failed',error=str(error)); failed=True
    print(json.dumps(result))
if failed: raise SystemExit(1)
