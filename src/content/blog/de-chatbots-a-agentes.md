---
title: "De chatbots a agentes: la arquitectura detrás de la IA que actúa"
description: "Los LLMs que responden preguntas ya no son suficientes. Acá exploro qué es realmente un sistema agéntico, cómo se diseña para producción, y qué lecciones aprendí construyendo uno."
date: 2026-06-11
tags: ["Agentic AI", "LLMs", "Arquitectura", "GCP"]
---

Hay un momento en cada proyecto de IA en el que te das cuenta de que el chatbot no es suficiente.

El usuario no quiere *hablar* con la IA. Quiere que la IA *haga cosas*. Que consulte una base de datos, que actualice un registro, que llame a una API, que tome una decisión. El giro de "responder" a "actuar" parece cosmético, pero cambia todo lo que está abajo.

Este artículo es sobre ese cambio.

---

## ¿Qué es realmente un sistema agéntico?

La palabra "agente" se usa tanto que ya perdió precisión. Así que voy a darle una definición operativa:

> Un sistema agéntico es aquel en el que un modelo de lenguaje decide **qué herramientas usar, en qué orden, y con qué parámetros**, en función de un objetivo dado.

No es un pipeline fijo. No es un grafo de nodos con transiciones predeterminadas. Es el modelo eligiendo el camino.

Esto tiene tres consecuencias inmediatas:

1. **El comportamiento es no determinista por diseño.** No hay un camino fijo; hay un espacio de posibles caminos que el modelo explora.
2. **Los errores son composicionales.** Un error en el paso 3 de 7 puede invalidar todo lo que vino después.
3. **La observabilidad pasa a ser crítica.** Si no sabés qué decidió el modelo en cada paso, no podés debuggear, mejorar ni confiar en el sistema.

---

## El loop fundamental

Todo sistema agéntico, independientemente del framework, implementa alguna variante de este loop:

```
Observar → Razonar → Actuar → Observar → ...
```

En código, eso se ve más o menos así:

```python
async def agent_loop(objective: str, tools: list[Tool], max_steps: int = 20):
    messages = [{"role": "user", "content": objective}]
    
    for step in range(max_steps):
        response = await llm.invoke(messages, tools=tools)
        
        if response.stop_reason == "end_turn":
            return response.content  # el agente terminó
        
        if response.stop_reason == "tool_use":
            tool_results = await execute_tools(response.tool_calls)
            messages.append(response)
            messages.append({"role": "tool", "content": tool_results})
            continue
        
        raise UnexpectedStopReason(response.stop_reason)
    
    raise MaxStepsExceeded(f"El agente no terminó en {max_steps} pasos")
```

Simple, pero con dos detalles cruciales que se pasan por alto:

- **`max_steps`** no es un parámetro de comodidad; es una guardrail de seguridad. Sin límite, un agente con una herramienta rota puede loopear indefinidamente.
- **Loggear cada paso** antes de `continue` es lo que te salva en producción. No después, *antes*. Si el paso falla, el log ya existe.

---

## Herramientas: la interfaz con el mundo real

Las herramientas son funciones que el modelo puede llamar. En la práctica, son el punto de mayor fricción del sistema.

El diseño de una buena herramienta sigue tres principios:

### 1. El nombre y la descripción son parte del prompt

El modelo elige qué herramienta usar basándose en sus nombres y descripciones. Una herramienta mal nombrada o mal documentada es una herramienta que el modelo va a usar mal.

```python
# Malo: ambiguo, el modelo no sabe cuándo usarlo
@tool(description="Obtener datos")
def get_data(query: str) -> dict: ...

# Bueno: específico, con contexto de cuándo aplica
@tool(description="Busca órdenes de compra en el sistema ERP por número de orden, cliente o fecha. Usar cuando el usuario pregunte sobre el estado de un pedido.")
def search_purchase_orders(
    order_number: str | None = None,
    customer_id: str | None = None,
    date_from: str | None = None,  # formato ISO 8601
) -> list[Order]: ...
```

### 2. Errores descriptivos > errores genéricos

Cuando una herramienta falla, el modelo lee el error y decide cómo continuar. Un error descriptivo le da información para recuperarse. Un error genérico lo manda a adivinar.

```python
# Malo
raise Exception("Error en la base de datos")

# Bueno
raise ToolError(
    "No se encontró ninguna orden con número ORD-9999. "
    "Verificá el número o buscá por nombre de cliente usando el parámetro customer_id."
)
```

### 3. Las herramientas destructivas necesitan confirmación

Cualquier herramienta que modifica estado — crear, actualizar, eliminar — debe tener un paso de confirmación o un modo de "dry run". El agente se puede equivocar, y el costo de una acción irreversible es alto.

---

## Memoria: el estado que persiste entre turnos

Un agente sin memoria es un agente que empieza de cero cada vez. Dependiendo del caso de uso, eso es aceptable o catastrófico.

Hay tres tipos de memoria que uso en producción:

| Tipo | Dónde vive | Para qué sirve |
|------|------------|----------------|
| **Working memory** | El contexto del LLM | Información del turno actual |
| **Episodic memory** | Vector DB (ej. AlloyDB) | "Acordarse" de conversaciones pasadas |
| **Semantic memory** | RAG + retrieval | Conocimiento del dominio de la empresa |

La trampa es querer usar los tres siempre. En la mayoría de los casos, el `working memory` (simplemente mantener el historial de mensajes en el contexto) es suficiente para 90% de los casos de uso.

La memoria episódica y semántica agrega latencia, complejidad y puntos de falla. No la agregues hasta que el caso de uso la necesite explícitamente.

---

## Observabilidad: si no lo medís, no existe

La observabilidad en sistemas agénticos tiene tres dimensiones:

**Trazas de ejecución**: cada paso del loop, con inputs/outputs del modelo y de cada herramienta. En GCP uso Cloud Trace con spans personalizados para cada `tool_use`.

**Métricas de calidad**: tasa de éxito por tipo de tarea, cantidad de pasos promedio, frecuencia de `MaxStepsExceeded`. Estas métricas te dicen si el agente está mejorando o empeorando.

**Evaluación offline**: un conjunto de casos de prueba con respuestas esperadas, que corre automáticamente en cada deploy. Es la diferencia entre "deployé y recé" y "deployé y sé".

```python
# Un evaluador simple pero efectivo
async def evaluate_agent(test_cases: list[TestCase]) -> EvalReport:
    results = []
    for case in test_cases:
        output = await agent_loop(case.input, tools=tools)
        score = await llm_judge(
            expected=case.expected_output,
            actual=output,
            rubric=case.rubric,
        )
        results.append(EvalResult(case=case, output=output, score=score))
    return EvalReport(results=results)
```

El `llm_judge` es otro LLM que evalúa si la respuesta del agente cumple con los criterios. No es perfecto, pero escala mucho mejor que la evaluación manual.

---

## Lo que aprendí

Tres cosas que cambiarían si empezara de cero:

**Empezar con menos herramientas.** La tentación es darle al agente acceso a todo el sistema desde el día uno. Error. Cada herramienta es una dimensión más de complejidad. Empezá con 3-5 herramientas bien definidas, y agregá más cuando tenés evidencia de que el agente las necesita.

**Loggear el razonamiento, no solo las acciones.** Claude y otros modelos pueden generar texto de razonamiento interno antes de llamar una herramienta. Ese razonamiento es oro para debugging. Guardarlo es gratis; perderlo es caro.

**Definir "done" antes de empezar.** El agente necesita saber cuándo terminó. Una instrucción vaga produce un agente que no sabe cuándo parar, que llama herramientas innecesarias, o que termina antes de tiempo. La definición del criterio de éxito va en el system prompt, no en el código.

---

La IA agéntica no es el futuro — es el presente. Lo que cambia es la madurez con la que se construye. Y esa madurez se consigue exactamente así: articulando lo que aprendiste, para que alguien más no tenga que aprenderlo de la misma manera difícil.
