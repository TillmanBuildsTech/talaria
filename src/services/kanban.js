// Wrapper around the Hermes `hermes kanban create` command.
// The CLI accepts a JSON body describing the goal and returns a kanban task ID.
export async function createGoal(body) {
  // Expecting a server at http://localhost:8649 (Talaria serve) that proxies /api/v1/* to hermes CLI
  // This will call the hermes CLI via the Hermes gateway, which already has our kanban board configured.
  const response = await fetch('http://localhost:8649/api/v1/kanban/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Kanban create failed: ${response.status} ${text}`)
  }

  const data = await response.json()
  return data.taskId
}