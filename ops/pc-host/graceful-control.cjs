// Parent-only IPC; invokes the framework's normal signal handler on Windows too.
if (process.connected) {
  const stop = () => {
    if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM', 'SIGTERM');
    else process.exit(1);
  };
  process.on('message', message => { if (message?.type === 'tuat-pc-host-stop') stop(); });
  process.once('disconnect', stop);
}
