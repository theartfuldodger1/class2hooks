import React, { Component } from "react";

class ClassWithState extends Component {

    constructor(props) {
        super(props);
        this.state = { num: 0};
    }
    
    render() {
        return (
            <div>
                <h1>{this.state.num}</h1>
            </div>
        )
    }
}

export default ClassWithState