import { createRoot } from 'react-dom/client'
import './styles.css'
import { Dashboard } from './dashboard/Dashboard'
import { Picker } from './recorder/Picker'
import { AreaSelect } from './recorder/AreaSelect'
import { Countdown } from './recorder/Countdown'
import { Toolbar } from './recorder/Toolbar'
import { Bubble } from './recorder/Bubble'
import { Capture } from './recorder/Capture'
import { Editor } from './editor/Editor'
import { ErrorBoundary } from './lib/ErrorBoundary'

const [route, query = ''] = window.location.hash.slice(1).split('?')
const params = new URLSearchParams(query)
document.documentElement.dataset.route = route

function App(): React.JSX.Element {
  switch (route) {
    case 'picker':
      return <Picker />
    case 'area':
      return <AreaSelect displayId={Number(params.get('display'))} />
    case 'countdown':
      return <Countdown />
    case 'toolbar':
      return <Toolbar />
    case 'bubble':
      return <Bubble deviceId={params.get('device') ?? ''} />
    case 'capture':
      return <Capture />
    case 'editor':
      return <Editor projectId={params.get('project') ?? ''} />
    default:
      return <Dashboard />
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
