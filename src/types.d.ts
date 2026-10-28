/* Shell scripts are bundled as text, see build.js */
declare module '*.sh' {
    const content: string;
    export default content;
}
