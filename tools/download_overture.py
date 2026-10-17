import pyarrow.fs as pafs, pyarrow.dataset as ds, pyarrow.compute as pc, pyarrow.parquet as pq, os, sys, json
from shapely import wkb
from concurrent.futures import ThreadPoolExecutor
# recuadro (lon/lat); TJ_BBOX="xmin,ymin,xmax,ymax" lo cambia. Por defecto: Centro, Zona Rio, Chapultepec, Hipodromo y Agua Caliente
xmin,ymin,xmax,ymax = map(float, os.environ.get("TJ_BBOX", "-117.142,32.438,-116.878,32.559").split(","))
px = os.environ.get("HTTPS_PROXY")  # opcional: solo si la red sale por un proxy
fs = pafs.S3FileSystem(anonymous=True, region="us-west-2", **({"proxy_options": px} if px else {}))
theme,typ,cols = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
base=f"overturemaps-us-west-2/release/2026-09-23.0/theme={theme}/type={typ}/"
files=[f.path for f in fs.get_file_info(pafs.FileSelector(base)) if f.path.endswith(".parquet")]
flt=(pc.field("bbox","xmin")<xmax)&(pc.field("bbox","xmax")>xmin)&(pc.field("bbox","ymin")<ymax)&(pc.field("bbox","ymax")>ymin)
def one(p):
    pf=pq.ParquetFile(p, filesystem=fs)
    md=pf.metadata; out=[]
    # find bbox column indices
    names=[md.schema.column(i).path for i in range(md.num_columns)]
    ix={n:names.index(n) for n in ["bbox.xmin","bbox.xmax","bbox.ymin","bbox.ymax"]}
    rgs=[]
    for r in range(md.num_row_groups):
        rg=md.row_group(r); s={k:rg.column(i).statistics for k,i in ix.items()}
        if s["bbox.xmin"].min<xmax and s["bbox.xmax"].max>xmin and s["bbox.ymin"].min<ymax and s["bbox.ymax"].max>ymin: rgs.append(r)
    if not rgs: return []
    t=pf.read_row_groups(rgs, columns=cols+["geometry","bbox"])
    t=t.filter(flt)
    return t.to_pylist()
# se escribe conforme llega cada archivo (con toda la ciudad, juntar todo antes se acababa la memoria)
n=0
with open(f"{typ}.geojson","w") as out, ThreadPoolExecutor(int(os.environ.get("TJ_HILOS", "6"))) as ex:
    out.write('{"type":"FeatureCollection","features":[')
    for rows in ex.map(one, files):
        for r in rows:
            g=wkb.loads(r.pop("geometry")); r.pop("bbox")
            out.write(("," if n else "") + json.dumps({"type":"Feature","properties":r,"geometry":g.__geo_interface__}, default=str))
            n+=1
        del rows
    out.write("]}")
print(typ, n)
