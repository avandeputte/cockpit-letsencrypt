// Minimal stand-in for cockpit.js in unit tests
const cockpit = {
    gettext: (s: string) => s,
    format: (fmt: string, ...args: unknown[]) => fmt.replace(/\$(\d+)/g, (_m, i) => String(args[Number(i)])),
};

export default cockpit;
