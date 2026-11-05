(() => {
  'use strict';
  const token = location.hash.slice(1);
  const respond = (value) => parent.postMessage({ miniMarkPlugin: token, ...value }, '*');
  let started = false;
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.token !== token || started) return;
    started = true;
    const { source, command, context } = event.data;
    if (typeof source !== 'string' || source.length > 200000) return;
    const prefix = `'use strict';
const reply = self.postMessage.bind(self);
let definition;
const miniMark = Object.freeze({ register(value) {
  if (definition) throw new Error('Only one plugin can be registered');
  definition = value;
}});
`;
    const suffix = `
;self.onmessage = async event => {
  try {
    if (!definition || !Array.isArray(definition.commands)) throw new Error('Missing miniMark.register definition');
    const commands = definition.commands;
    if (event.data.command == null) {
      reply({ value: { id: definition.id, name: definition.name, version: definition.version,
        commands: commands.map(command => ({ id: command.id, title: command.title })) } });
    } else {
      const command = commands.find(item => item.id === event.data.command);
      if (!command || typeof command.run !== 'function') throw new Error('Command is unavailable');
      reply({ value: await command.run(event.data.context) });
    }
  } catch (error) { reply({ error: String(error?.message || error).slice(0, 500) }); }
};`;
    const url = URL.createObjectURL(new Blob([prefix, source, suffix], { type: 'text/javascript' }));
    let worker;
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      worker?.terminate();
      URL.revokeObjectURL(url);
      respond(value);
    };
    try {
      worker = new Worker(url);
      worker.onmessage = event => finish({ result: event.data });
      worker.onerror = event => { event.preventDefault(); finish({ error: event.message || '插件执行失败' }); };
      worker.postMessage({ command, context });
    } catch (error) { finish({ error: String(error?.message || error) }); }
  });
  respond({ ready: true });
})();
