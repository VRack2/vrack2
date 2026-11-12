# vrack2.Master

Command controller of the master process. Every client command passes Guard -> Master: Master checks access level, validates `data` against the command `rules`, then calls the handler. Unknown commands are forwarded to the submaster (ServiceManager), which routes commands carrying a `service` param into the matching running service worker.

Access rule: client level must be <= command level. Level 1 = admin, 3 = regular, 1000 = public (callable even unauthenticated).

## commandsList
Catalog of all registered commands (level-0 internal commands are hidden).
- level: 3 (guest level 1000 cannot call it)
- params: none
- returns: `{ [commandName]: { command, description, level, rules, owner, short, icon, return } }`
- use: call first to discover the available command set.
