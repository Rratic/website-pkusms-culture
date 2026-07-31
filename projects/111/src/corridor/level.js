const corridorLevel = {
	id: "corridor",
	blocks: [
		{
			id: "corridor-intro",
			type: "text",
			kicker: true,
			title: "智华楼一楼走廊",
			src: new URL("./content/intro.html", import.meta.url),
		},
		{
			id: "corridor-exit",
			type: "actions",
			actions: [{ label: "前往图书角", target: "library" }],
		},
	],
};

export default corridorLevel;
