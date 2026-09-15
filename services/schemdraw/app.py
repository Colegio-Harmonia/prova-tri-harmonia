from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
import schemdraw
import schemdraw.elements as elm

app = FastAPI()

class Component(BaseModel):
    kind: str = Field(pattern='^(resistor|capacitor|diode|led|source|ground|line)$')
    label: str | None = Field(default=None, max_length=60)
    direction: str = Field(default='right', pattern='^(right|left|up|down)$')

class Circuit(BaseModel):
    components: list[Component] = Field(min_length=1, max_length=40)

@app.get('/health')
def health(): return {'ok': True}

@app.post('/render/circuit')
def render_circuit(spec: Circuit):
    mapping = {'resistor': elm.Resistor, 'capacitor': elm.Capacitor, 'diode': elm.Diode, 'led': elm.LED, 'source': elm.SourceV, 'ground': elm.Ground, 'line': elm.Line}
    try:
        with schemdraw.Drawing(show=False) as drawing:
            for component in spec.components:
                item = mapping[component.kind]().theta({'right': 0, 'up': 90, 'left': 180, 'down': -90}[component.direction])
                if component.label: item.label(component.label)
                drawing.add(item)
            svg = drawing.get_imagedata('svg')
        return Response(content=svg, media_type='image/svg+xml')
    except Exception as error:
        raise HTTPException(status_code=422, detail='Circuito inválido') from error
