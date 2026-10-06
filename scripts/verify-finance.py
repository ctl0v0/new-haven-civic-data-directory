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

def inspect_pdf(document,kind):
    from io import BytesIO
    from pypdf import PdfReader
    content,content_type,resolved=request(document['url'],20000000)
    if not content.startswith(b'%PDF-'): raise ValueError('Selected document is not a PDF')
    reader=PdfReader(BytesIO(content))
    if reader.is_encrypted: raise ValueError('Selected PDF is encrypted')
    page_count=len(reader.pages)
    if page_count>700: raise ValueError('Selected PDF exceeds page-count inspection limit')
    texts=[page.extract_text(extraction_mode='layout') or '' for page in reader.pages]
    table_pages=[]
    for i,text in enumerate(texts):
        upper=text.upper()
        if 'BUDGET' in upper and ('ACTUAL' in upper or 'EXPENDITURE' in upper or 'REVENUE' in upper):
            table_pages.append({'page':i+1,'excerpt':text[:5000]})
        if len(table_pages)>=3: break
    return {'label':document['label'],'url':document['url'],'bytes':len(content),'content_type':content_type,'pages':page_count,'pages_with_substantial_text':sum(len(t.strip())>=100 for t in texts),'nonempty_text_pages':sum(bool(t.strip()) for t in texts),'first_page_excerpt':texts[0][:1800] if texts else '', 'table_page_samples':table_pages,'kind':kind,'scope':'PDF download and text extraction inspection only; no financial totals reconciled or reusable table schema validated'}

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
        result.update(title=title,document_links_found=len(documents))
        if name=='monthly':
            dates=[]
            for doc in documents:
                try:
                    import datetime
                    date=datetime.datetime.strptime(doc['label'],'%B %Y')
                    dates.append((date,doc))
                except ValueError: pass
            if not dates: raise ValueError('No dated monthly report links found')
            sample=max(dates,key=lambda item:item[0])[1]
            result['latest_monthly_label_found']=sample['label']
        else:
            candidates=[doc for doc in documents if 'adopted budget' in doc['label'].lower()]
            if not candidates: raise ValueError('No adopted budget link found')
            sample=max(candidates,key=lambda doc: max([int(y) for y in re.findall(r'\b20\d{2}\b',doc['label'])] or [0]))
        result['sample']=inspect_pdf(sample,name)
        result['warnings']=['A sample PDF was downloaded and text extracted; tables, totals, archive completeness, posting dates and reuse terms need separate validation.']
        result['scope']='Official index retrieval plus one selected PDF download and text inspection per series'
        if not documents: raise ValueError('No expected finance document links found')
        result['status']='passed'
    except Exception as error:
        result.update(status='failed',error=str(error)); failed=True
    print(json.dumps(result))
if failed: raise SystemExit(1)
