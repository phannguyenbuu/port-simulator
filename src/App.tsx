import Bottle3DViewer from './components/bottle_3d_viewer/Bottle3DViewer';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', backgroundColor: '#090d22' }}>
      <Bottle3DViewer moldCode="port-simulation-game" />
    </div>
  );
}

export default App;
