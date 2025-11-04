declare module 'translate-google' {
  interface TranslateOptions {
    from?: string;
    to?: string;
    except?: string[];
  }

  function translate(
    text: string | object | any[],
    options?: TranslateOptions
  ): Promise<string | object | any[]>;

  export default translate;
}
