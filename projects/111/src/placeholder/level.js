const placeholderLevel = {
  id: "placeholder",
  blocks: [
    {
      type: "text",
      kicker: true,
      title: "占位",
      src: new URL("./content/intro.html", import.meta.url),
    },
  ],
};

export default placeholderLevel;
